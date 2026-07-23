import compression from "compression";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import ipAnonymize from "ip-anonymize";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { GameEnv } from "../core/configuration/Config";
import { GameType } from "../core/game/Game";
import {
  ClientMessageSchema,
  ID,
  MAX_HOSTED_LOBBIES,
  PartialGameRecordSchema,
  ServerErrorMessage,
} from "../core/Schemas";
import { generateID, replacer } from "../core/Util";
import { CreateGameInputSchema } from "../core/WorkerSchemas";
import { registerAdminBotRoutes } from "./AdminBotRoutes";
import { archive, finalizeGameRecord } from "./Archive";
import { censorPlayer } from "./Censor";
import { Client } from "./Client";
import { GameManager } from "./GameManager";
import { registerGamePreviewRoute } from "./GamePreviewRoute";
import type { GameServer } from "./GameServer";
import { verifyJoin } from "./JoinVerify";
import { getUserMe, verifyClientToken } from "./jwt";
import { logger } from "./Logger";
import { enforceVerifiedBadge } from "./Privilege";

import { MapPlaylist } from "./MapPlaylist";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import { startPolling } from "./PollingLoop";
import { PrivilegeRefresher } from "./PrivilegeRefresher";
import { ServerEnv } from "./ServerEnv";
import { applyStaticAssetCacheControl } from "./StaticAssetCache";
import { WorkerLobbyService } from "./WorkerLobbyService";
import { initWorkerMetrics } from "./WorkerMetrics";

const workerId = ServerEnv.workerId() ?? 0;
const log = logger.child({ comp: `w_${workerId}` });
const playlist = new MapPlaylist();

// Worker setup
export async function startWorker() {
  log.info(`Worker starting...`);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const server = http.createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024, // 1MB
  });

  const gm = new GameManager(log);

  // Initialize lobby service (handles WebSocket upgrade routing)
  const lobbyService = new WorkerLobbyService(server, wss, gm, log);

  setTimeout(
    () => {
      startMatchmakingPolling(gm);
    },
    1000 + Math.random() * 2000,
  );

  if (ServerEnv.otelEnabled()) {
    initWorkerMetrics(gm);
  }

  const privilegeRefresher = new PrivilegeRefresher(
    ServerEnv.jwtIssuer() + "/cosmetics.json",
    ServerEnv.apiKey(),
    ServerEnv.jwtIssuer() + "/reserved_clan_tags",
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

  app.use(
    express.static(path.join(__dirname, "../../out"), {
      setHeaders: (res) => {
        applyStaticAssetCacheControl(
          res.setHeader.bind(res),
          res.req.originalUrl,
        );
      },
    }),
  );
  app.use(
    "/maps",
    express.static(path.join(__dirname, "../../static/maps"), {
      maxAge: "1y",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".webp")) {
          res.setHeader("Content-Type", "image/webp");
        }
      },
    }),
  );
  app.use(
    rateLimit({
      windowMs: 1000, // 1 second
      max: 20, // 20 requests per IP per second
    }),
  );

  app.use("/api", (_req, res, next) => {
    setNoStoreHeaders(res);
    next();
  });

  // Create a new private game. The worker mints an id that belongs to itself
  // and returns it, so callers don't need to know the sharding. nginx (and the
  // vite dev proxy) randomly route here to spread new games across workers.
  app.post("/api/create_game", async (req, res) => {
    // Identify the creator from their token. Never accept persistentID directly.
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res
        .status(400)
        .json({ error: "Authorization header required to create a game" });
    }
    const auth = await verifyClientToken(
      authHeader.substring("Bearer ".length),
    );
    if (auth.type !== "success") {
      log.warn(`Invalid creator token: ${auth.message}`);
      return res.status(401).json({ error: "Invalid creator token" });
    }
    const creatorPersistentID = auth.persistentId;

    const parsed = CreateGameInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const gc = parsed.data;
    // Public games are scheduled by the master over IPC, never created here.
    if (gc?.gameType === GameType.Public) {
      return res
        .status(400)
        .json({ error: "Cannot create public games via this endpoint" });
    }

    // Reuse-lobby flow: ?previous=<gameID> marks this creation as the successor
    // of a finished private game, so its remaining players get told the new id
    // and can hop over without re-sharing a link. The previous game lives on
    // this same worker (callers hit /wX/api/create_game for it), which is also
    // where the successor is minted. Going through this endpoint (instead of a
    // websocket message) keeps game creation behind its rate limits.
    let previousGame: GameServer | null = null;
    if (req.query.previous !== undefined) {
      const prevId = ID.safeParse(req.query.previous);
      if (!prevId.success) {
        return res.status(400).json({ error: "Invalid previous game id" });
      }
      previousGame = gm.game(prevId.data);
      if (previousGame === null) {
        return res.status(404).json({ error: "Previous game not found" });
      }
      if (!previousGame.isCreator(creatorPersistentID)) {
        return res.status(403).json({
          error: "Only the lobby creator can create a successor lobby",
        });
      }
      // Reusing a lobby is a private-lobby feature: a public game's players
      // never opted into following a host to another game.
      if (previousGame.isPublic()) {
        return res
          .status(403)
          .json({ error: "Public games cannot spawn a successor lobby" });
      }
      // Idempotent: a repeat request (e.g. a double click) reuses the already
      // minted successor instead of creating another one.
      const existingId = previousGame.successorLobby();
      const existing = existingId !== null ? gm.game(existingId) : null;
      if (existingId !== null && existing !== null) {
        previousGame.setSuccessorLobby(existingId); // re-broadcast for late joiners
        return res.json({
          ...existing.gameInfo(),
          workerIndex: workerId,
          workerPath: ServerEnv.workerPath(existingId),
        });
      }
      // A recorded successor that no longer exists (already cleaned up) falls
      // through and gets replaced by a fresh lobby.
    }

    const id = ServerEnv.generateGameIdForWorker(workerId);
    if (id === null) {
      log.warn(`Failed to mint game id on worker ${workerId}`);
      return res.status(500).json({ error: "Could not allocate game id" });
    }

    const game = gm.createGame(id, gc, creatorPersistentID);
    if (game === null) {
      log.warn(`cannot create game, id ${id} already exists`);
      return res.status(409).json({ error: "Game ID already exists" });
    }

    // Tell the previous game about its successor: it remembers the id (for
    // idempotency) and broadcasts it to everyone still connected. Done after
    // creation so a failed creation never broadcasts a dead id.
    previousGame?.setSuccessorLobby(id);

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const clientIP = req.ip || req.socket.remoteAddress || "unknown";
    log.info(
      `Worker ${workerId}: IP ${ipAnonymize(clientIP)} creating private${gc?.gameMode ? ` ${gc.gameMode}` : ""} game with id ${id}, creator: ${creatorPersistentID.substring(0, 8)}...`,
    );
    res.json({
      ...game.gameInfo(),
      workerIndex: workerId,
      workerPath: ServerEnv.workerPath(id),
    });
  });

  // Toggle whether a private lobby is visible in the public lobby browser.
  // Creator-only; listing requires an active subscription (checked fresh
  // against the API) and is limited to one listed lobby per creator.
  app.post("/api/game/:id/listing", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(400).json({ error: "Authorization header required" });
    }
    const token = authHeader.substring("Bearer ".length);
    const auth = await verifyClientToken(token);
    if (auth.type !== "success") {
      return res.status(401).json({ error: "Invalid token" });
    }

    const parsed = z.object({ listed: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const { listed } = parsed.data;

    const game = gm.game(req.params.id);
    if (game === null) {
      return res.status(404).json({ error: "Game not found" });
    }
    if (!game.isCreator(auth.persistentId)) {
      return res
        .status(403)
        .json({ error: "Only the lobby creator can change its listing" });
    }
    if (game.isPublic() || game.hasStarted()) {
      return res.status(409).json({ error: "Game cannot be listed" });
    }

    if (listed) {
      // A whitelisted lobby would be advertised to everyone yet reject every
      // joiner; the whitelist itself is stripped from the broadcast, so
      // browsers could not even tell why.
      if (game.hasJoinWhitelist()) {
        return res.status(409).json({ error: "listing_whitelist_enabled" });
      }

      // Host cheats give the host an asymmetric advantage over players
      // recruited from the lobby browser. Enabling them while listed is
      // likewise rejected (GameServer's update_game_config handling).
      if (game.hasHostCheats()) {
        return res.status(409).json({ error: "listing_host_cheats_enabled" });
      }

      // Dev has no subscription backend; skip the check so the feature is
      // testable locally (same precedent as Turnstile).
      if (ServerEnv.env() !== GameEnv.Dev) {
        const userMe = await getUserMe(token);
        if (userMe.type === "error") {
          log.warn(
            `listing rejected, user me fetch failed: ${userMe.message}`,
            {
              gameID: req.params.id,
            },
          );
          return res.status(403).json({ error: "subscription_required" });
        }
        if (!userMe.response.player.canCreatePublicLobbies) {
          return res.status(403).json({ error: "subscription_required" });
        }
      }

      const creatorID = game.hashedCreatorID();
      if (
        creatorID !== undefined &&
        lobbyService.creatorHasListedLobby(creatorID, game.id)
      ) {
        return res.status(409).json({ error: "listing_limit_reached" });
      }

      // Cluster-wide cap to prevent listing spam. Approximate here (the
      // broadcast lags by ~1s); the master's cap is the backstop.
      if (lobbyService.hostedLobbyCount() >= MAX_HOSTED_LOBBIES) {
        return res.status(409).json({ error: "listing_full" });
      }
    }

    game.setListed(listed);
    log.info(`lobby listing ${listed ? "enabled" : "disabled"}`, {
      gameID: game.id,
    });
    res.json({ listed });
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

  registerGamePreviewRoute({
    app,
    gm,
    workerId,
    log,
    baseDir: __dirname,
  });

  registerAdminBotRoutes({ app, gm, workerId, log });

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

      archive(
        finalizeGameRecord(gameRecord),
        privilegeRefresher.getCosmeticFlagUrls(),
      );
      res.json({
        success: true,
      });
    } catch (error) {
      log.error("Error processing archive request:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // WebSocket handling
  wss.on("connection", (ws: WebSocket, req) => {
    ws.on("message", async (message: string) => {
      const ip = getClientIp(req);

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
        } else if (clientMsg.type !== "join" && clientMsg.type !== "rejoin") {
          log.warn(
            `Invalid message before join: ${JSON.stringify(clientMsg, replacer)}`,
          );
          return;
        }

        // Verify this worker should handle this game
        const expectedWorkerId = ServerEnv.workerIndex(clientMsg.gameID);
        if (expectedWorkerId !== workerId) {
          log.warn(
            `Worker mismatch: Game ${clientMsg.gameID} should be on worker ${expectedWorkerId}, but this is worker ${workerId}`,
          );
          return;
        }

        // Verify token signature
        const result = await verifyClientToken(clientMsg.token);
        if (result.type === "error") {
          log.warn(`Invalid token: ${result.message}`, {
            gameID: clientMsg.gameID,
          });
          ws.close(1002, `Unauthorized: invalid token`);
          return;
        }
        const { persistentId, claims } = result;

        if (claims?.role === "banned") {
          ws.close(1002, "Account Banned");
          return;
        }

        if (clientMsg.type === "rejoin") {
          log.info("rejoining game", {
            gameID: clientMsg.gameID,
            persistentID: persistentId,
          });
          const wasFound = gm.rejoinClient(
            ws,
            persistentId,
            clientMsg.gameID,
            clientMsg.lastTurn,
          );
          if (!wasFound) {
            log.warn(
              `game ${clientMsg.gameID} not found on worker ${workerId}`,
            );
            ws.close(1002, "Game not found");
          }
          return;
        }

        // Basic local screen as the fallback identity for every path
        // join_verify doesn't cover: Dev, API failure (fail-open joins), and
        // re-admitted reconnects with no stored identity. An approved
        // join_verify overwrites it with the API's display-ready pair below.
        let { username, clanTag } = censorPlayer(
          clientMsg.username,
          clientMsg.clanTag ?? null,
        );

        // Try to reconnect an existing client (e.g., page refresh).
        // If successful, skip all authorization — the client keeps the
        // identity screened at its original join, so a refresh can't smuggle
        // in an unscreened name.
        if (gm.rejoinClient(ws, persistentId, clientMsg.gameID, 0)) {
          return;
        }

        let flares: string[] | undefined;
        let publicId: string | undefined;
        let friends: string[] = [];
        let ownedClanTags: string[] = [];
        let accountUsername:
          | { username?: string | null; usernameStatus?: string }
          | undefined;

        const allowedFlares = ServerEnv.allowedFlares();
        if (claims === null) {
          if (allowedFlares !== undefined) {
            log.warn("Unauthorized: Anonymous user attempted to join game");
            ws.close(1002, "Unauthorized");
            return;
          }
        } else {
          // Verify token and get player permissions
          const result = await getUserMe(clientMsg.token);
          if (result.type === "error") {
            log.warn(`Unauthorized: ${result.message}`, {
              persistentID: persistentId,
              gameID: clientMsg.gameID,
            });
            ws.close(1002, "Unauthorized: user me fetch failed");
            return;
          }
          flares = result.response.player.flares;
          publicId = result.response.player.publicId;
          friends = result.response.player.friends;
          ownedClanTags = result.response.player.clans?.map((c) => c.tag) ?? [];
          accountUsername = result.response.player;

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

        // Gate the join and screen the display name in one API call: status
        // is the Turnstile verdict, and the response carries the
        // display-ready (username, clanTag) pair, so a banned name is never
        // visible — not even in the lobby. Turnstile gates the FIRST join
        // only: an already-admitted player who reconnects (e.g. a socket
        // drop during the lobby->start transition) must not be re-challenged
        // — their original token is single-use and was already redeemed —
        // so the token is omitted for them and the API runs the name check
        // alone (an omitted token is always approved).
        if (ServerEnv.env() !== GameEnv.Dev) {
          const isReadmit = gm.wasAdmitted(clientMsg.gameID, persistentId);
          // SECURITY: the API skips siteverify entirely when the token is
          // omitted, trusting the game server to only do that for
          // re-admits. A first join must therefore present a token — a
          // null token here would otherwise be a full Turnstile bypass.
          if (!isReadmit && !clientMsg.turnstileToken) {
            log.warn("Unauthorized: missing Turnstile token", {
              persistentID: persistentId,
              gameID: clientMsg.gameID,
            });
            ws.close(1002, "Unauthorized: Turnstile token rejected");
            return;
          }
          const verdict = await verifyJoin(
            ip,
            isReadmit ? null : clientMsg.turnstileToken,
            clientMsg.username,
            clientMsg.clanTag ?? null,
          );
          switch (verdict.status) {
            case "approved":
              username = verdict.username;
              clanTag = verdict.clanTag;
              break;
            case "rejected":
              // Only reachable on first joins: re-admits omit the token,
              // which the API always approves.
              log.warn("Unauthorized: Turnstile token rejected", {
                persistentID: persistentId,
                gameID: clientMsg.gameID,
                reason: verdict.reason,
              });
              ws.close(1002, "Unauthorized: Turnstile token rejected");
              return;
            case "error":
              // Fail open: the locally screened name stands.
              log.error("join_verify error", {
                persistentID: persistentId,
                gameID: clientMsg.gameID,
                reason: verdict.reason,
              });
          }
        }

        // Enforce clan tag ownership: a player can wear a tag only if they're
        // a member; a real clan they're not in (or an unverifiable tag) is
        // dropped to prevent impersonation. Fictional tags pass through.
        const resolution = privilegeRefresher
          .get()
          .resolveClanTag(clanTag, ownedClanTags);
        if (resolution.dropped) {
          log.warn("Dropped clan tag: player is not a member", {
            persistentID: persistentId,
            gameID: clientMsg.gameID,
            clanTag,
          });
        }
        const resolvedClanTag = resolution.tag;

        const cosmeticResult = privilegeRefresher
          .get()
          .isAllowed(flares ?? [], clientMsg.cosmetics ?? {});

        if (cosmeticResult.type === "forbidden") {
          log.warn(`Forbidden: ${cosmeticResult.reason}`, {
            persistentID: persistentId,
            gameID: clientMsg.gameID,
          });
          ws.close(1002, cosmeticResult.reason);
          return;
        }

        // An undefined account means an anonymous persistent-ID join (no
        // /users/@me fetch) — enforceVerifiedBadge treats that as Dev-only.
        if (
          enforceVerifiedBadge(
            cosmeticResult.cosmetics,
            username,
            accountUsername ?? null,
          )
        ) {
          log.info("Stripped unvouched verified-badge claim", {
            persistentID: persistentId,
            gameID: clientMsg.gameID,
          });
        }

        // Create client and add to game
        const client = new Client(
          generateID(),
          persistentId,
          claims,
          claims?.role ?? null,
          flares,
          ip,
          username,
          resolvedClanTag,
          ws,
          cosmeticResult.cosmetics,
          publicId,
          friends,
        );

        const joinResult = gm.joinClient(client, clientMsg.gameID);

        if (joinResult === "not_found") {
          log.info(`game ${clientMsg.gameID} not found on worker ${workerId}`);
          ws.close(1002, "Game not found");
        } else if (joinResult === "kicked") {
          log.warn(`kicked client tried to join game ${clientMsg.gameID}`, {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(1002, "Cannot join game");
        } else if (joinResult === "not_allowlisted") {
          log.info(`client not whitelisted for game ${clientMsg.gameID}`, {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(1002, "You are not whitelisted");
        } else if (joinResult === "rejected") {
          log.info(`client rejected from game ${clientMsg.gameID}`, {
            gameID: clientMsg.gameID,
            workerId,
          });
          ws.close(1002, "Lobby full");
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
  const PORT = ServerEnv.workerPortByIndex(workerId);
  server.listen(PORT, () => {
    log.info(`running on http://localhost:${PORT}`);
    log.info(`Handling requests with path prefix /w${workerId}/`);
    // Signal to the master process that this worker is ready
    lobbyService.sendReady(workerId);
    log.info(`signaled ready state to master`);
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

async function startMatchmakingPolling(gm: GameManager) {
  // One checkin serves exactly one queue, so a host serving both modes
  // runs one long-poll loop per mode.
  startMatchmakingLoop(gm, "1v1");
  startMatchmakingLoop(gm, "2v2");
}

const MatchmakingAssignmentSchema = z.object({
  // Flat list of matched players' publicIds.
  players: z.array(z.string()),
  // The matcher's team split ([[a],[b]] for 1v1). Optional for tolerance,
  // but the current API always sends it.
  teams: z.array(z.array(z.string())).optional(),
});

function startMatchmakingLoop(gm: GameManager, mode: "1v1" | "2v2") {
  startPolling(
    async () => {
      try {
        const url = `${ServerEnv.jwtIssuer() + "/matchmaking/checkin"}`;
        const gameId = ServerEnv.generateGameIdForWorker(workerId);
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
            "x-api-key": ServerEnv.apiKey(),
          },
          body: JSON.stringify({
            id: workerId,
            gameId: gameId,
            ccu: gm.activeClients(),
            instanceId: process.env.INSTANCE_ID,
            mode,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          log.warn(
            `Failed to poll ${mode} lobby: ${response.status} ${response.statusText}`,
          );
          return;
        }

        const data = await response.json();
        log.info(`Lobby ${mode} poll successful:`, data);

        if (data.assignment) {
          const parsed = MatchmakingAssignmentSchema.safeParse(data.assignment);
          if (!parsed.success) {
            // Don't strand the matched players: create the game without
            // the allowlist/team pins rather than dropping the match.
            log.warn(
              `Unexpected ${mode} assignment shape: ${z.prettifyError(parsed.error)}`,
            );
          }
          const baseConfig =
            mode === "2v2" ? playlist.get2v2Config() : playlist.get1v1Config();
          const game = gm.createGame(
            gameId,
            parsed.success
              ? { ...baseConfig, allowedPublicIds: parsed.data.players }
              : baseConfig,
            undefined,
            Date.now() + 7000,
            undefined,
            parsed.success ? parsed.data.teams : undefined,
          );
          if (game === null) {
            log.warn(`Failed to create matchmaking game ${gameId}`);
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          // Abort is expected if no game is scheduled on this worker.
          return;
        }
        log.error(`Error polling ${mode} lobby:`, error);
      }
    },
    5000 + Math.random() * 1000,
  );
}

function getClientIp(req: http.IncomingMessage): string {
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp) return cfIp;
  return req.socket.remoteAddress ?? "unknown";
}
