import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import ipAnonymize from "ip-anonymize";
import { base64url } from "jose";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { COSMETICS } from "../core/CosmeticSchemas";
import { GameType } from "../core/game/Game";
import {
  ClientMessageSchema,
  GameRecord,
  GameRecordSchema,
  ServerErrorMessage,
} from "../core/Schemas";
import { CreateGameInputSchema, GameInputSchema } from "../core/WorkerSchemas";
import { archive, readGameRecord } from "./Archive";
import { Client } from "./Client";
import { GameManager } from "./GameManager";
import { gatekeeper, LimiterType } from "./Gatekeeper";
import { getUserMe, verifyClientToken } from "./jwt";
import { logger } from "./Logger";
import { PrivilegeChecker } from "./Privilege";
import { initWorkerMetrics } from "./WorkerMetrics";

const config = getServerConfigFromServer();

const workerId = parseInt(process.env.WORKER_ID ?? "0");
const log = logger.child({ comp: `w_${workerId}` });

// Worker setup
export function startWorker() {
  log.info(`Worker starting...`);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const gm = new GameManager(config, log);

  const privilegeChecker = new PrivilegeChecker(COSMETICS, base64url.decode);

  if (config.otelEnabled()) {
    initWorkerMetrics(gm);
  }

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
      windowMs: 1000, // 1 second
      max: 20, // 20 requests per IP per second
    }),
  );

  app.post(
    "/api/create_game/:id",
    gatekeeper.httpHandler(LimiterType.Post, async (req, res) => {
      const id = req.params.id;
      if (!id) {
        log.warn(`cannot create game, id not found`);
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

      const game = gm.createGame(id, gc);

      log.info(
        `Worker ${workerId}: IP ${ipAnonymize(clientIP)} creating game ${game.isPublic() ? "Public" : "Private"} with id ${id}`,
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
      });
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

      if (!gameRecord) {
        return res.status(404).json({
          success: false,
          error: "Game not found",
          exists: false,
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
          success: false,
          error: "Version mismatch",
          exists: true,
          details: {
            expectedCommit: config.gitCommit(),
            actualCommit: gameRecord.gitCommit,
          },
        });
      }

      return res.status(200).json({
        success: true,
        exists: true,
        gameRecord: gameRecord,
      });
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
      gatekeeper.wsHandler(req, async (message: string) => {
        const forwarded = req.headers["x-forwarded-for"];
        const ip = Array.isArray(forwarded)
          ? forwarded[0]
          : // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            forwarded || req.socket.remoteAddress || "unknown";

        try {
          // Parse and handle client messages
          const parsed = ClientMessageSchema.safeParse(
            JSON.parse(message.toString()),
          );
          if (!parsed.success) {
            const error = z.prettifyError(parsed.error);
            log.warn("Error parsing client message", error);
            ws.send(
              JSON.stringify({
                type: "error",
                error: error.toString(),
              } satisfies ServerErrorMessage),
            );
            ws.removeAllListeners();
            ws.close(1002, "ClientJoinMessageSchema");
            return;
          }
          const clientMsg = parsed.data;

          if (clientMsg.type === "ping") {
            // Ignore ping
            return;
          } else if (clientMsg.type !== "join") {
            const error = `Invalid message before join: ${JSON.stringify(clientMsg)}`;
            log.warn(error);
            ws.send(
              JSON.stringify({
                type: "error",
                error,
              } satisfies ServerErrorMessage),
            );
            ws.removeAllListeners();
            ws.close(1002, "ClientJoinMessageSchema");
            return;
          }

          // Verify this worker should handle this game
          const expectedWorkerId = config.workerIndex(clientMsg.gameID);
          if (expectedWorkerId !== workerId) {
            log.warn(
              `Worker mismatch: Game ${clientMsg.gameID} should be on worker ${expectedWorkerId}, but this is worker ${workerId}`,
            );
            return;
          }

          // Verify token signature
          const result = await verifyClientToken(clientMsg.token, config);
          if (result === false) {
            log.warn("Unauthorized: Invalid token");
            ws.removeAllListeners();
            ws.close(1002, "Unauthorized");
            return;
          }
          const { persistentId, claims } = result;

          let roles: string[] | undefined;
          let flares: string[] | undefined;

          const allowedFlares = config.allowedFlares();
          if (claims === null) {
            if (allowedFlares !== undefined) {
              log.warn("Unauthorized: Anonymous user attempted to join game");
              ws.removeAllListeners();
              ws.close(1002, "Unauthorized");
              return;
            }
          } else {
            // Verify token and get player permissions
            const result = await getUserMe(clientMsg.token, config);
            if (result === false) {
              log.warn("Unauthorized: Invalid session");
              ws.removeAllListeners();
              ws.close(1002, "Unauthorized");
              return;
            }
            roles = result.player.roles;
            flares = result.player.flares;

            if (allowedFlares !== undefined) {
              const allowed =
                allowedFlares.length === 0 ||
                allowedFlares.some((f) => flares?.includes(f));
              if (!allowed) {
                log.warn(
                  "Forbidden: player without an allowed flare attempted to join game",
                );
                ws.removeAllListeners();
                ws.close(1002, "Forbidden");
                return;
              }
            }
          }

          // Check if the flag is allowed
          if (clientMsg.flag !== undefined) {
            if (clientMsg.flag.startsWith("!")) {
              const allowed = privilegeChecker.isCustomFlagAllowed(
                clientMsg.flag,
                roles,
                flares,
              );
              if (allowed !== true) {
                log.warn(`Custom flag ${allowed}: ${clientMsg.flag}`);
                ws.removeAllListeners();
                ws.close(1002, `Custom flag ${allowed}`);
                return;
              }
            }
          }

          // Check if the pattern is allowed
          if (clientMsg.pattern !== undefined) {
            const allowed = privilegeChecker.isPatternAllowed(
              clientMsg.pattern,
              roles,
              flares,
            );
            if (allowed !== true) {
              log.warn(`Pattern ${allowed}: ${clientMsg.pattern}`);
              ws.removeAllListeners();
              ws.close(1002, `Pattern ${allowed}`);
              return;
            }
          }

          // Create client and add to game
          const client = new Client(
            clientMsg.clientID,
            persistentId,
            claims,
            roles,
            flares,
            ip,
            clientMsg.username,
            ws,
            clientMsg.flag,
            clientMsg.pattern,
          );

          const wasFound = gm.addClient(
            client,
            clientMsg.gameID,
            clientMsg.lastTurn,
          );

          if (!wasFound) {
            log.info(
              `game ${clientMsg.gameID} not found on worker ${workerId}`,
            );
            // Handle game not found case
          }

          // Handle other message types
        } catch (error) {
          ws.removeAllListeners();
          ws.close(1011, "Internal server error");
          log.warn(
            `error handling websocket message for ${ipAnonymize(ip)}: ${error}`.substring(
              0,
              250,
            ),
          );
        }
      }),
    );

    ws.on("error", (error: Error) => {
      ws.removeAllListeners();
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
        workerId: workerId,
      });
      log.info(`signaled ready state to master`);
    }
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    log.error(`Error in ${req.method} ${req.path}:`, err);
    res.status(500).json({ error: "An unexpected error occurred" });
  });

  // Process-level error handlers
  process.on("uncaughtException", (err) => {
    log.error(`uncaught exception:`, err);
  });

  process.on("unhandledRejection", (reason, promise) => {
    log.error(`unhandled rejection at:`, promise, "reason:", reason);
  });
}
