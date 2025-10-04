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
  ID,
  PartialGameRecordSchema,
  PlayerCosmeticRefs,
  PlayerCosmetics,
  PlayerPattern,
  ServerErrorMessage,
} from "../core/Schemas";
import { replacer } from "../core/Util";
import { CreateGameInputSchema, GameInputSchema } from "../core/WorkerSchemas";
import { archive, finalizeGameRecord } from "./Archive";
import { Client } from "./Client";
import { GameManager } from "./GameManager";
import { getUserMe, verifyClientToken } from "./jwt";
import { logger } from "./Logger";
import { RankedCoordinator } from "./ranked/RankedCoordinator";
import { RankedRepository } from "./ranked/RankedRepository";
import {
  RankedMatchAcceptSchema,
  RankedMatchDeclineSchema,
  RankedMatchIdSchema,
  RankedQueueJoinRequestSchema,
  RankedTicketIdSchema,
} from "./ranked/RankedSchemas";

import { assertNever } from "../core/Util";
import { PrivilegeRefresher } from "./PrivilegeRefresher";
import { initWorkerMetrics } from "./WorkerMetrics";

const config = getServerConfigFromServer();

const workerId = parseInt(process.env.WORKER_ID ?? "0");
const log = logger.child({ comp: `w_${workerId}` });

// Worker setup
export async function startWorker() {
  log.info(`Worker starting...`);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const gm = new GameManager(config, log);

  const rankedRepository = RankedRepository.create(
    log.child({ comp: "ranked_repo" }),
  );
  const rankedCoordinator = new RankedCoordinator(gm, log, rankedRepository);
  await rankedCoordinator.initialize();

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
    const originalPath = req.url;
    const match = originalPath.match(/^\/w(\d+)(.*)$/);

    if (match) {
      const pathWorkerId = parseInt(match[1]);
      const actualPath = match[2] || "/";

      if (pathWorkerId !== workerId) {
        return res.status(404).json({
          error: "Worker mismatch",
          message: `This is worker ${workerId}, but you requested worker ${pathWorkerId}`,
        });
      }

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

    const game = gm.createGame(id, gc, creatorClientID);

    log.info(
      `Worker ${workerId}: IP ${ipAnonymize(clientIP)} creating ${game.isPublic() ? "Public" : "Private"}${gc?.gameMode ? ` ${gc.gameMode}` : ""} game with id ${id}${creatorClientID ? `, creator: ${creatorClientID}` : ""}`,
    );
    res.json(game.gameInfo());
  });

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
    game.start();
    res.status(200).json({ success: true });
  });

  app.put("/api/game/:id", async (req, res) => {
    const result = GameInputSchema.safeParse(req.body);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      return res.status(400).json({ error });
    }
    const bodyConfig = result.data;

    const lobbyID = req.params.id;
    if (bodyConfig.gameType === GameType.Public) {
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
    game.updateGameConfig(bodyConfig);
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

  async function authenticateRankedRequest(
    req: Request,
    res: Response,
  ): Promise<{ playerId: string } | null> {
    const authorization = req.headers.authorization;
    if (!authorization) {
      res.status(401).json({ error: "Authorization required" });
      return null;
    }

    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      res.status(401).json({ error: "Authorization required" });
      return null;
    }

    const token = match[1].trim();
    if (token.length === 0) {
      res.status(401).json({ error: "Authorization required" });
      return null;
    }

    try {
      const verification = await verifyClientToken(token, config);
      if (verification === false || verification.claims === null) {
        res.status(401).json({ error: "Authentication required" });
        return null;
      }

      return { playerId: verification.persistentId };
    } catch (error) {
      log.error("failed to authenticate ranked request", { error });
      res.status(500).json({ error: "Failed to verify authentication" });
      return null;
    }
  }

  app.post("/api/ranked/queue", async (req, res) => {
    const auth = await authenticateRankedRequest(req, res);
    if (!auth) {
      return;
    }

    const result = RankedQueueJoinRequestSchema.safeParse(req.body);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      return res.status(400).json({ error });
    }

    if (result.data.playerId !== auth.playerId) {
      log.warn("ranked queue join player mismatch", {
        expectedPlayerId: auth.playerId,
        providedPlayerId: result.data.playerId,
      });
      return res.status(403).json({ error: "Player mismatch" });
    }

    try {
      const ticket = await rankedCoordinator.join({
        playerId: auth.playerId,
        mode: result.data.mode,
        region: result.data.region,
        mmr: result.data.mmr,
        username: result.data.username,
      });
      res.status(201).json({ ticket });
    } catch (error) {
      log.error("failed to join ranked queue", { error });
      res.status(500).json({ error: "Failed to join ranked queue" });
    }
  });

  app.get("/api/ranked/queue/:ticketId", async (req, res) => {
    const auth = await authenticateRankedRequest(req, res);
    if (!auth) {
      return;
    }

    const ticketId = req.params.ticketId;
    if (!RankedTicketIdSchema.safeParse(ticketId).success) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }

    const ticket = rankedCoordinator.get(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    if (ticket.playerId !== auth.playerId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    res.json({ ticket });
  });

  app.delete("/api/ranked/queue/:ticketId", async (req, res) => {
    const auth = await authenticateRankedRequest(req, res);
    if (!auth) {
      return;
    }

    const ticketId = req.params.ticketId;
    if (!RankedTicketIdSchema.safeParse(ticketId).success) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }

    const ticketView = rankedCoordinator.get(ticketId);
    if (!ticketView) {
      return res.status(404).json({
        error: "Ticket not found or already processed",
      });
    }

    if (ticketView.playerId !== auth.playerId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    try {
      const removed = await rankedCoordinator.leave(ticketId);
      if (!removed) {
        return res.status(404).json({
          error: "Ticket not found or already processed",
        });
      }

      res.status(204).send();
    } catch (error) {
      log.error("failed to leave ranked queue", { error });
      res.status(500).json({ error: "Failed to leave ranked queue" });
    }
  });

  app.post("/api/ranked/match/:matchId/accept", async (req, res) => {
    const auth = await authenticateRankedRequest(req, res);
    if (!auth) {
      return;
    }

    const matchId = req.params.matchId;
    if (!RankedMatchIdSchema.safeParse(matchId).success) {
      return res.status(400).json({ error: "Invalid match id" });
    }

    const parsed = RankedMatchAcceptSchema.safeParse(req.body);
    if (!parsed.success) {
      const error = z.prettifyError(parsed.error);
      return res.status(400).json({ error });
    }

    const { ticketId, playerId: requestPlayerId, acceptToken } = parsed.data;
    if (requestPlayerId !== auth.playerId) {
      log.warn("ranked match accept player mismatch", {
        expectedPlayerId: auth.playerId,
        providedPlayerId: requestPlayerId,
      });
      return res.status(403).json({ error: "Player mismatch" });
    }

    const ticketView = rankedCoordinator.get(ticketId);
    if (
      !ticketView ||
      ticketView.playerId !== auth.playerId ||
      ticketView.match?.matchId !== matchId
    ) {
      return res.status(404).json({ error: "Ticket not found for match" });
    }

    try {
      const ticket = await rankedCoordinator.accept(
        matchId,
        ticketId,
        acceptToken,
      );
      if (!ticket) {
        return res
          .status(404)
          .json({ error: "Match not found or already processed" });
      }

      res.json({ ticket });
    } catch (error) {
      log.error("failed to accept ranked match", {
        error,
        matchId,
        ticketId,
        playerId: auth.playerId,
      });
      res.status(500).json({ error: "Failed to accept ranked match" });
    }
  });

  app.post("/api/ranked/match/:matchId/decline", async (req, res) => {
    const auth = await authenticateRankedRequest(req, res);
    if (!auth) {
      return;
    }

    const matchId = req.params.matchId;
    if (!RankedMatchIdSchema.safeParse(matchId).success) {
      return res.status(400).json({ error: "Invalid match id" });
    }

    const parsed = RankedMatchDeclineSchema.safeParse(req.body);
    if (!parsed.success) {
      const error = z.prettifyError(parsed.error);
      return res.status(400).json({ error });
    }

    const { ticketId, playerId: requestPlayerId } = parsed.data;
    if (requestPlayerId !== auth.playerId) {
      log.warn("ranked match decline player mismatch", {
        expectedPlayerId: auth.playerId,
        providedPlayerId: requestPlayerId,
      });
      return res.status(403).json({ error: "Player mismatch" });
    }

    const ticketView = rankedCoordinator.get(ticketId);
    if (
      !ticketView ||
      ticketView.playerId !== auth.playerId ||
      ticketView.match?.matchId !== matchId
    ) {
      return res.status(404).json({ error: "Ticket not found for match" });
    }

    try {
      const ticket = await rankedCoordinator.decline(matchId, ticketId);
      if (!ticket) {
        return res
          .status(404)
          .json({ error: "Match not found or already processed" });
      }

      res.json({ ticket });
    } catch (error) {
      log.error("failed to decline ranked match", {
        error,
        matchId,
        ticketId,
        playerId: auth.playerId,
      });
      res.status(500).json({ error: "Failed to decline ranked match" });
    }
  });

  // === WEBSOCKET HANDLERS ===
  wss.on("connection", (ws: WebSocket, req) => {
    const ip = req.socket.remoteAddress ?? "unknown";
    const url = req.url ?? "/";

    log.info("WebSocket connection attempt", { url, ip });

    // Handle ranked queue WebSocket connections
    if (url.includes("/ws/ranked")) {
      log.info("Routing to ranked WebSocket handler");
      rankedCoordinator.handleWebSocketConnection(ws, req);
      return;
    }

    log.info("Routing to game WebSocket handler");
    // Handle game WebSocket connections (existing logic)

    ws.on("message", async (data: Buffer | string) => {
      try {
        const text = typeof data === "string" ? data : data.toString("utf8");
        const parsed = ClientMessageSchema.safeParse(JSON.parse(text));

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
          return; // Ignore ping
        } else if (clientMsg.type !== "join") {
          log.warn(
            `Invalid message before join: ${JSON.stringify(
              clientMsg,
              replacer,
            )}`,
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
        const verifyResult = await verifyClientToken(clientMsg.token, config);
        if (verifyResult === false) {
          log.warn("Unauthorized: Invalid token");
          ws.close(1002, "Unauthorized");
          return;
        }
        const { persistentId, claims } = verifyResult;

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
          // Verify session and read roles/flares
          const me = await getUserMe(clientMsg.token, config);
          if (me === false) {
            log.warn("Unauthorized: Invalid session");
            ws.close(1002, "Unauthorized");
            return;
          }
          roles = me.player.roles;
          flares = me.player.flares;

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

        const { perm, cosmetics, error } = checkCosmetics(
          clientMsg.cosmetics,
          flares ?? [],
        );
        if (perm === "forbidden") {
          log.warn(`Forbidden: ${error}`, {
            clientID: clientMsg.clientID,
          });
          ws.close(1002, error);
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
          cosmetics,
        );

        const wasFound = gm.addClient(
          client,
          clientMsg.gameID,
          clientMsg.lastTurn,
        );

        if (!wasFound) {
          log.info(`game ${clientMsg.gameID} not found on worker ${workerId}`);
          // Optionally: ws.close(1002, "GameNotFound");
        }
      } catch (error) {
        ws.close(1011, "Internal server error");
        log.warn(
          `error handling websocket message for ${ipAnonymize(ip)}: ${String(
            error,
          )}`.substring(0, 250),
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

  function checkCosmetics(
    cosmetics: PlayerCosmeticRefs | undefined,
    flares: readonly string[],
  ): {
    perm: "forbidden" | "allowed";
    cosmetics?: PlayerCosmetics | undefined;
    error?: string;
  } {
    if (cosmetics === undefined) {
      return {
        perm: "allowed",
        cosmetics: undefined,
      };
    }

    // Check if the flag is allowed
    if (cosmetics.flag !== undefined) {
      if (cosmetics.flag.startsWith("!")) {
        const allowed = privilegeRefresher
          .get()
          .isCustomFlagAllowed(cosmetics.flag, flares);
        if (allowed !== true) {
          log.warn(`Custom flag ${allowed}: ${cosmetics.flag}`);
          return {
            perm: "forbidden",
            error: `Custom flag ${allowed}`,
          };
        }
      }
    }

    let pattern: PlayerPattern | undefined;
    // Check if the pattern is allowed
    if (cosmetics.patternName !== undefined) {
      const result = privilegeRefresher
        .get()
        .isPatternAllowed(
          flares,
          cosmetics.patternName,
          cosmetics.patternColorPaletteName ?? null,
        );
      switch (result.type) {
        case "allowed":
          pattern = result.pattern;
          break;
        case "unknown":
          log.warn(`Pattern ${cosmetics.patternName} unknown`);
          return {
            perm: "forbidden",
            error: "Could not look up pattern, backend may be offline",
          };
        case "forbidden":
          log.warn(`Pattern ${cosmetics.patternName}: ${result.reason}`);
          return {
            perm: "forbidden",
            error: `Pattern ${cosmetics.patternName}: ${result.reason}`,
          };
        default:
          assertNever(result);
      }
    }

    return {
      perm: "allowed",
      cosmetics: {
        flag: cosmetics.flag,
        pattern: pattern,
      },
    };
  }

  app.get("/api/ranked/leaderboard", async (req, res) => {
    if (!rankedRepository) {
      return res.json({ seasonId: null, entries: [] });
    }

    const auth = await authenticateRankedRequest(req, res);
    if (!auth) {
      return;
    }

    const seasonParam = Array.isArray(req.query.seasonId)
      ? req.query.seasonId[0]
      : req.query.seasonId;
    let seasonId: number | null;

    if (seasonParam !== undefined) {
      const parsedSeason = Number(seasonParam);
      if (!Number.isFinite(parsedSeason) || parsedSeason < 0) {
        return res.status(400).json({ error: "Invalid seasonId" });
      }
      seasonId = Math.floor(parsedSeason);
    } else {
      seasonId = await rankedRepository.getActiveSeasonId();
    }

    if (seasonId === null) {
      return res.json({ seasonId: null, entries: [] });
    }

    const limitParam = Array.isArray(req.query.limit)
      ? req.query.limit[0]
      : req.query.limit;
    const offsetParam = Array.isArray(req.query.offset)
      ? req.query.offset[0]
      : req.query.offset;

    const limitValue = limitParam !== undefined ? Number(limitParam) : 25;
    const offsetValue = offsetParam !== undefined ? Number(offsetParam) : 0;

    if (!Number.isFinite(limitValue) || limitValue <= 0) {
      return res.status(400).json({ error: "Invalid limit" });
    }
    if (!Number.isFinite(offsetValue) || offsetValue < 0) {
      return res.status(400).json({ error: "Invalid offset" });
    }

    const safeLimit = Math.min(Math.floor(limitValue), 100);
    const safeOffset = Math.floor(offsetValue);

    const leaderboard = await rankedRepository.getLeaderboard(
      seasonId,
      safeLimit,
      safeOffset,
    );
    const entries = leaderboard.map((entry, index) => ({
      ...entry,
      rank: safeOffset + index + 1,
    }));

    res.json({ seasonId, entries });
  });

  app.get("/api/ranked/history", async (req, res) => {
    if (!rankedRepository) {
      return res.json({ seasonId: null, matches: [] });
    }

    const auth = await authenticateRankedRequest(req, res);
    if (!auth) {
      return;
    }

    const seasonParam = Array.isArray(req.query.seasonId)
      ? req.query.seasonId[0]
      : req.query.seasonId;
    let seasonId: number | null;

    if (seasonParam !== undefined) {
      const parsedSeason = Number(seasonParam);
      if (!Number.isFinite(parsedSeason) || parsedSeason < 0) {
        return res.status(400).json({ error: "Invalid seasonId" });
      }
      seasonId = Math.floor(parsedSeason);
    } else {
      seasonId = await rankedRepository.getActiveSeasonId();
    }

    if (seasonId === null) {
      return res.json({ seasonId: null, matches: [] });
    }

    const limitParam = Array.isArray(req.query.limit)
      ? req.query.limit[0]
      : req.query.limit;
    const offsetParam = Array.isArray(req.query.offset)
      ? req.query.offset[0]
      : req.query.offset;

    const limitValue = limitParam !== undefined ? Number(limitParam) : 20;
    const offsetValue = offsetParam !== undefined ? Number(offsetParam) : 0;

    if (!Number.isFinite(limitValue) || limitValue <= 0) {
      return res.status(400).json({ error: "Invalid limit" });
    }
    if (!Number.isFinite(offsetValue) || offsetValue < 0) {
      return res.status(400).json({ error: "Invalid offset" });
    }

    const safeLimit = Math.min(Math.floor(limitValue), 100);
    const safeOffset = Math.floor(offsetValue);

    const matches = await rankedRepository.getPlayerMatchHistory(
      auth.playerId,
      seasonId,
      safeLimit,
      safeOffset,
    );

    res.json({ seasonId, matches });
  });

  // The load balancer will handle routing to this server based on path
  const PORT = config.workerPortByIndex(workerId);
  server.listen(PORT, () => {
    log.info(`running on http://localhost:${PORT}`);
    log.info(`Handling requests with path prefix /w${workerId}/`);
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
