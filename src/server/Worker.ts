import {
  CreateGameInputSchema,
  GameInputSchema,
  WorkerApiGameIdExists,
} from "../core/WorkerSchemas";
import { GameRecord, GameRecordSchema } from "../core/Schemas";
import { LimiterType, gatekeeper } from "./Gatekeeper";
import { WebSocket, WebSocketServer } from "ws";
import { archive, readGameRecord } from "./Archive";
import express, { NextFunction, Request, Response } from "express";
import { GameEnv } from "../core/configuration/Config";
import { GameManager } from "./GameManager";
import { GameType } from "../core/game/Game";
import { ID } from "../core/BaseSchemas";
import { PrivilegeRefresher } from "./PrivilegeRefresher";
import { fileURLToPath } from "url";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import http from "http";
import { initWorkerMetrics } from "./WorkerMetrics";
import ipAnonymize from "ip-anonymize";
import { logger } from "./Logger";
import path from "path";
import { preJoinMessageHandler } from "./worker/websocket/handler/message/PreJoinHandler";
import rateLimit from "express-rate-limit";
import { replacer } from "../core/Util";
import { z } from "zod";

const config = getServerConfigFromServer();

const workerId = parseInt(process.env.WORKER_ID ?? "0");
const log = logger.child({ comp: `w_${workerId}` });

// Worker setup
export async function startWorker() {
  log.info("Worker starting...");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const gm = new GameManager(config, log);

  if (config.otelEnabled()) {
    initWorkerMetrics(gm);
  }

  const privilegeRefresher = new PrivilegeRefresher(
    config.jwtIssuer() + "/cosmetics.json",
    log,
  );
  privilegeRefresher.start();

  // Middleware to handle /wX path prefix
  app.use((req, res, next) => {
    // Extract the original path without the worker prefix
    const originalPath = req.url;
    const match = originalPath.match(/^\/w(\d+)(.*)$/);

    if (match) {
      const pathWorkerId = parseInt(match[1]);
      const actualPath = match[2] || "/";

      // Verify this request is for the correct worker
      if (pathWorkerId !== workerId) {
        return res.status(404).json({
          error: "Worker mismatch",
          message: `This is worker ${workerId}, but you requested worker ${pathWorkerId}`,
        });
      }

      // Update the URL to remove the worker prefix
      req.url = actualPath;
    }

    next();
  });

  app.set("trust proxy", 3);
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "../../out")));
  app.use(
    rateLimit({
      max: 20, // 20 requests per IP per second
      windowMs: 1000, // 1 second
    }),
  );

  app.post(
    "/api/create_game/:id",
    gatekeeper.httpHandler(LimiterType.Post, async (req, res) => {
      const { id } = req.params;
      const creatorClientID = (() => {
        if (typeof req.query.creatorClientID !== "string") return undefined;

        const trimmed = req.query.creatorClientID.trim();
        return ID.safeParse(trimmed).success ? trimmed : undefined;
      })();

      if (!id) {
        log.warn("cannot create game, id not found");
        return res.status(400).json({ error: "Game ID is required" });
      }
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const clientIP = req.ip || req.socket.remoteAddress || "unknown";
      const result = CreateGameInputSchema.safeParse(req.body);
      if (!result.success) {
        const error = z.prettifyError(result.error);
        return res.status(400).json({ error });
      }

      const gc = result.data;
      if (
        gc?.gameType === GameType.Public &&
        req.headers[config.adminHeader()] !== config.adminToken()
      ) {
        log.warn(
          `cannot create public game ${id}, ip ${ipAnonymize(clientIP)} incorrect admin token`,
        );
        return res.status(401).send("Unauthorized");
      }

      // Double-check this worker should host this game
      const expectedWorkerId = config.workerIndex(id);
      if (expectedWorkerId !== workerId) {
        log.warn(
          `This game ${id} should be on worker ${expectedWorkerId}, but this is worker ${workerId}`,
        );
        return res.status(400).json({ error: "Worker, game id mismatch" });
      }

      // Pass creatorClientID to createGame
      const game = gm.createGame(id, gc, creatorClientID);

      log.info(
        `Worker ${
          workerId
        }: IP ${
          ipAnonymize(clientIP)
        } creating ${
          game.isPublic() ? "Public" : "Private"
        }${
          gc?.gameMode ? ` ${gc.gameMode}` : ""
        } game with id ${
          id
        }${
          creatorClientID ? `, creator: ${creatorClientID}` : ""
        }`,
      );
      res.json(game.gameInfo());
    }),
  );

  // Add other endpoints from your original server
  app.post(
    "/api/start_game/:id",
    gatekeeper.httpHandler(LimiterType.Post, async (req, res) => {
      log.info(`starting private lobby with id ${req.params.id}`);
      const game = gm.game(req.params.id);
      if (!game) {
        return;
      }
      if (game.isPublic()) {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        const clientIP = req.ip || req.socket.remoteAddress || "unknown";
        log.info(
          `cannot start public game ${game.id}, game is public, ip: ${ipAnonymize(clientIP)}`,
        );
        return;
      }
      game.start();
      res.status(200).json({ success: true });
    }),
  );

  app.put(
    "/api/game/:id",
    gatekeeper.httpHandler(LimiterType.Put, async (req, res) => {
      const result = GameInputSchema.safeParse(req.body);
      if (!result.success) {
        const error = z.prettifyError(result.error);
        return res.status(400).json({ error });
      }
      const config = result.data;
      // TODO: only update public game if from local host
      const lobbyID = req.params.id;
      if (config.gameType === GameType.Public) {
        log.info(`cannot update game ${lobbyID} to public`);
        return res.status(400).json({ error: "Cannot update public game" });
      }
      const game = gm.game(lobbyID);
      if (!game) {
        return res.status(400).json({ error: "Game not found" });
      }
      if (game.isPublic()) {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        const clientIP = req.ip || req.socket.remoteAddress || "unknown";
        log.warn(
          `cannot update public game ${game.id}, ip: ${ipAnonymize(clientIP)}`,
        );
        return res.status(400).json({ error: "Cannot update public game" });
      }
      if (game.hasStarted()) {
        log.warn(`cannot update game ${game.id} after it has started`);
        return res
          .status(400)
          .json({ error: "Cannot update game after it has started" });
      }
      game.updateGameConfig(config);
      res.status(200).json({ success: true });
    }),
  );

  app.get(
    "/api/game/:id/exists",
    gatekeeper.httpHandler(LimiterType.Get, async (req, res) => {
      const lobbyId = req.params.id;
      res.json({
        exists: gm.game(lobbyId) !== null,
      } satisfies WorkerApiGameIdExists);
    }),
  );

  app.get(
    "/api/game/:id",
    gatekeeper.httpHandler(LimiterType.Get, async (req, res) => {
      const game = gm.game(req.params.id);
      if (game === null) {
        log.info(`lobby ${req.params.id} not found`);
        return res.status(404).json({ error: "Game not found" });
      }
      res.json(game.gameInfo());
    }),
  );

  app.get(
    "/api/archived_game/:id",
    gatekeeper.httpHandler(LimiterType.Get, async (req, res) => {
      const gameRecord = await readGameRecord(req.params.id);

      if (typeof gameRecord === "string") {
        return res.status(404).json({
          error: gameRecord,
          exists: false,
          success: false,
        });
      }

      if (
        config.env() !== GameEnv.Dev &&
        gameRecord.gitCommit !== config.gitCommit()
      ) {
        log.warn(
          `git commit mismatch for game ${req.params.id}, expected ${config.gitCommit()}, got ${gameRecord.gitCommit}`,
        );
        return res.status(409).json({
          details: {
            actualCommit: gameRecord.gitCommit,
            expectedCommit: config.gitCommit(),
          },
          error: "Version mismatch",
          exists: true,
          success: false,
        });
      }

      return res
        .status(200)
        .header("Content-Type", "application/json")
        .send(
          JSON.stringify(
            {
              exists: true,
              gameRecord,
              success: true,
            },
            replacer,
          ),
        );
    }),
  );

  app.post(
    "/api/archive_singleplayer_game",
    gatekeeper.httpHandler(LimiterType.Post, async (req, res) => {
      const result = GameRecordSchema.safeParse(req.body);
      if (!result.success) {
        const error = z.prettifyError(result.error);
        log.info(error);
        return res.status(400).json({ error });
      }

      const gameRecord: GameRecord = result.data;
      archive(gameRecord);
      res.json({
        success: true,
      });
    }),
  );

  app.post(
    "/api/kick_player/:gameID/:clientID",
    gatekeeper.httpHandler(LimiterType.Post, async (req, res) => {
      if (req.headers[config.adminHeader()] !== config.adminToken()) {
        res.status(401).send("Unauthorized");
        return;
      }

      const { gameID, clientID } = req.params;

      const game = gm.game(gameID);
      if (!game) {
        res.status(404).send("Game not found");
        return;
      }

      game.kickClient(clientID);
      res.status(200).send("Player kicked successfully");
    }),
  );

  // WebSocket handling
  wss.on("connection", (ws: WebSocket, req) => {
    ws.on(
      "message",
      gatekeeper.wsHandler(req, (message) =>
        preJoinMessageHandler(req, ws, privilegeRefresher, gm, message),
      ),
    );

    ws.on("error", (error: Error) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
        ws.close(1002, "WS_ERR_UNEXPECTED_RSV_1");
      }
    });
    ws.on("close", () => {
      ws.removeAllListeners();
    });
  });

  // The load balancer will handle routing to this server based on path
  const PORT = config.workerPortByIndex(workerId);
  server.listen(PORT, () => {
    log.info(`running on http://localhost:${PORT}`);
    log.info(`Handling requests with path prefix /w${workerId}/`);
    // Signal to the master process that this worker is ready
    if (process.send) {
      process.send({
        type: "WORKER_READY",
        workerId,
      });
      log.info("signaled ready state to master");
    }
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    log.error(`Error in ${req.method} ${req.path}:`, err);
    res.status(500).json({ error: "An unexpected error occurred" });
  });

  // Process-level error handlers
  process.on("uncaughtException", (err) => {
    log.error("uncaught exception:", err);
  });

  process.on("unhandledRejection", (reason, promise) => {
    log.error("unhandled rejection at:", promise, "reason:", reason);
  });
}
