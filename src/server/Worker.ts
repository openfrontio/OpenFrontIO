import compression from "compression";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import ipAnonymize from "ip-anonymize";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameType } from "../core/game/Game";
import {
  ClientMessageSchema,
  GameID,
  ID,
  PartialGameRecordSchema,
  ServerErrorMessage,
} from "../core/Schemas";
import { generateID, replacer } from "../core/Util";
import { CreateGameInputSchema, GameInputSchema } from "../core/WorkerSchemas";
import { archive, finalizeGameRecord } from "./Archive";
import { Client } from "./Client";
import { GameManager } from "./GameManager";
import { getUserMe, verifyClientToken } from "./jwt";
import { logger } from "./Logger";

import { MapPlaylist } from "./MapPlaylist";
import { PrivilegeRefresher } from "./PrivilegeRefresher";
import { initWorkerMetrics } from "./WorkerMetrics";

const config = getServerConfigFromServer();

const workerId = parseInt(process.env.WORKER_ID ?? "0");
const log = logger.child({ comp: `w_${workerId}` });
const playlist = new MapPlaylist(true);

// Worker setup
export async function startWorker() {
  log.info(`Worker starting...`);

  if (config.enableMatchmaking()) {
    log.info("Starting matchmaking");
    setTimeout(
      () => {
        pollLobby(gm);
      },
      1000 + Math.random() * 2000,
    );
  } else {
    log.info("Matchmaking disabled");
  }

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
  app.use(compression());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "../../out")));
  app.use(
    rateLimit({
      windowMs: 1000, // 1 second
      max: 20, // 20 requests per IP per second
    }),
  );

  app.post("/api/create_game/:id", async (req, res) => {
    const id = req.params.id;
    const creatorClientID = (() => {
      if (typeof req.query.creatorClientID !== "string") return undefined;

      const trimmed = req.query.creatorClientID.trim();
      return ID.safeParse(trimmed).success ? trimmed : undefined;
    })();

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

    // Pass creatorClientID to createGame
    const game = gm.createGame(id, gc, creatorClientID);
    const hostToken = { hostToken: game.createHostToken() };

    log.info(
      `Worker ${workerId}: IP ${ipAnonymize(clientIP)} creating ${game.isPublic() ? "Public" : "Private"}${gc?.gameMode ? ` ${gc.gameMode}` : ""} game with id ${id}${creatorClientID ? `, creator: ${creatorClientID}` : ""}`,
    );
    res.json({ ...game.gameInfo(), ...hostToken });
  });

  // Add other endpoints from your original server
  app.post("/api/start_game/:id", async (req, res) => {
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
    const hostToken = req.body.hostToken ?? "";

    if (hostToken !== game.getHostToken()) {
      log.info(`cannot start private game ${game.id}, requestor is not host`);
      res.status(403).json({ success: false });
      return;
    }
    game.start();
    res.status(200).json({ success: true });
  });

  app.put("/api/game/:id", async (req, res) => {
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
  });

  app.get("/api/game/:id/exists", async (req, res) => {
    const lobbyId = req.params.id;
    res.json({
      exists: gm.game(lobbyId) !== null,
    });
  });

  app.get("/api/game/:id", async (req, res) => {
    const game = gm.game(req.params.id);
    if (game === null) {
      log.info(`lobby ${req.params.id} not found`);
      return res.status(404).json({ error: "Game not found" });
    }
    res.json(game.gameInfo());
  });

  app.post("/api/archive_singleplayer_game", async (req, res) => {
    try {
      const record = req.body;

      const result = PartialGameRecordSchema.safeParse(record);
      if (!result.success) {
        const error = z.prettifyError(result.error);
        log.info(error);
        return res.status(400).json({ error });
      }
      const gameRecord = result.data;

      if (gameRecord.info.config.gameType !== GameType.Singleplayer) {
        log.warn(
          `cannot archive singleplayer with game type ${gameRecord.info.config.gameType}`,
          {
            gameID: gameRecord.info.gameID,
          },
        );
        return res.status(400).json({ error: "Invalid request" });
      }

      if (result.data.info.players.length !== 1) {
        log.warn(`cannot archive singleplayer game multiple players`, {
          gameID: gameRecord.info.gameID,
        });
        return res.status(400).json({ error: "Invalid request" });
      }

      log.info("archiving singleplayer game", {
        gameID: gameRecord.info.gameID,
      });

      archive(finalizeGameRecord(gameRecord));
      res.json({
        success: true,
      });
    } catch (error) {
      log.error("Error processing archive request:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/kick_player/:gameID/:clientID", async (req, res) => {
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
  });

  // WebSocket handling
  wss.on("connection", (ws: WebSocket, req) => {
    ws.on("message", async (message: string) => {
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
          ws.close(1002, "ClientJoinMessageSchema");
          return;
        }
        const clientMsg = parsed.data;

        if (clientMsg.type === "ping") {
          // Ignore ping
          return;
        } else if (clientMsg.type !== "join") {
          log.warn(
            `Invalid message before join: ${JSON.stringify(clientMsg, replacer)}`,
          );
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
            ws.close(1002, "Unauthorized");
            return;
          }
        } else {
          // Verify token and get player permissions
          const result = await getUserMe(clientMsg.token, config);
          if (result === false) {
            log.warn("Unauthorized: Invalid session");
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
              ws.close(1002, "Forbidden");
              return;
            }
          }
        }

        const cosmeticResult = privilegeRefresher
          .get()
          .isAllowed(flares ?? [], clientMsg.cosmetics ?? {});

        if (cosmeticResult.type === "forbidden") {
          log.warn(`Forbidden: ${cosmeticResult.reason}`, {
            clientID: clientMsg.clientID,
          });
          ws.close(1002, cosmeticResult.reason);
          return;
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
          cosmeticResult.cosmetics,
        );

        const wasFound = gm.addClient(
          client,
          clientMsg.gameID,
          clientMsg.lastTurn,
        );

        if (!wasFound) {
          log.info(`game ${clientMsg.gameID} not found on worker ${workerId}`);
          // Handle game not found case
        }

        // Handle other message types
      } catch (error) {
        ws.close(1011, "Internal server error");
        log.warn(
          `error handling websocket message for ${ipAnonymize(ip)}: ${error}`.substring(
            0,
            250,
          ),
        );
      }
    });

    ws.on("error", (error: Error) => {
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

async function pollLobby(gm: GameManager) {
  try {
    const url = `${config.jwtIssuer() + "/matchmaking/checkin"}`;
    const gameId = generateGameIdForWorker();
    if (gameId === null) {
      log.warn(`Failed to generate game ID for worker ${workerId}`);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey(),
      },
      body: JSON.stringify({
        id: workerId,
        gameId: gameId,
        ccu: gm.activeClients(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.warn(
        `Failed to poll lobby: ${response.status} ${response.statusText}`,
      );
      return;
    }

    const data = await response.json();
    log.info(`Lobby poll successful:`, data);

    if (data.assignment) {
      // TODO: Only allow specified players to join the game.
      console.log(`Creating game ${gameId}`);
      const game = gm.createGame(gameId, playlist.gameConfig());
      setTimeout(() => {
        // Wait a few seconds to allow clients to connect.
        console.log(`Starting game ${gameId}`);
        game.start();
      }, 5000);
    }
  } catch (error) {
    log.error(`Error polling lobby:`, error);
  } finally {
    setTimeout(
      () => {
        pollLobby(gm);
      },
      5000 + Math.random() * 1000,
    );
  }
}

// TODO: This is a hack to generate a game ID for the worker.
// It should be replaced with a more robust solution.
function generateGameIdForWorker(): GameID | null {
  let attempts = 1000;
  while (attempts > 0) {
    const gameId = generateID();
    if (workerId === config.workerIndex(gameId)) {
      return gameId;
    }
    attempts--;
  }
  log.warn(`Failed to generate game ID for worker ${workerId}`);
  return null;
}
