import compression from "compression";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import ipAnonymize from "ip-anonymize";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { UserMeResponse } from "../core/ApiSchemas";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameType } from "../core/game/Game";
import {
  ClientMessageSchema,
  GameID,
  PartialGameRecordSchema,
  ServerErrorMessage,
} from "../core/Schemas";
import { generateID, replacer } from "../core/Util";
import { CreateGameInputSchema } from "../core/WorkerSchemas";
import { archive, finalizeGameRecord } from "./Archive";
import { Client } from "./Client";
import { GameManager } from "./GameManager";
import { registerGamePreviewRoute } from "./GamePreviewRoute";
import { getUserMe, verifyClientToken } from "./jwt";
import { logger } from "./Logger";

import { GameEnv } from "../core/configuration/Config";
import { MapPlaylist } from "./MapPlaylist";
import { startPolling } from "./PollingLoop";
import { PrivilegeRefresher } from "./PrivilegeRefresher";
import { verifyTurnstileToken } from "./Turnstile";
import { WorkerLobbyService } from "./WorkerLobbyService";
import { initWorkerMetrics } from "./WorkerMetrics";

const config = getServerConfigFromServer();

const workerId = parseInt(process.env.WORKER_ID ?? "0");
const log = logger.child({ comp: `w_${workerId}` });
const playlist = new MapPlaylist();

type DiscordRoleRequirement = {
  guildId: string;
  roleId: string;
};

function getDiscordGuildRolesFromUserMe(
  userMe: UserMeResponse,
): Record<string, string[]> | undefined {
  const fromUserObject =
    userMe.user.discordGuildRoles ?? userMe.user.discord_guild_roles;
  if (fromUserObject !== undefined) {
    return fromUserObject;
  }
  return userMe.user.discord?.guildRoles ?? userMe.user.discord?.guild_roles;
}

function normalizeRequiredDiscordRoles(
  requiredDiscordRoles: Array<{ guildId: string; roleId: string }> | undefined,
  legacyGuildId: string | undefined,
  legacyRoleId: string | undefined,
): DiscordRoleRequirement[] {
  const normalizedRequirements: DiscordRoleRequirement[] = [];
  const uniqueRequirementKeys = new Set<string>();

  for (const requirement of requiredDiscordRoles ?? []) {
    const guildId = requirement.guildId.trim();
    const roleId = requirement.roleId.trim();
    if (!guildId || !roleId) {
      continue;
    }
    const key = `${guildId}:${roleId}`;
    if (uniqueRequirementKeys.has(key)) {
      continue;
    }
    uniqueRequirementKeys.add(key);
    normalizedRequirements.push({ guildId, roleId });
  }

  const normalizedLegacyGuildId = legacyGuildId?.trim();
  const normalizedLegacyRoleId = legacyRoleId?.trim();
  if (normalizedLegacyGuildId && normalizedLegacyRoleId) {
    const key = `${normalizedLegacyGuildId}:${normalizedLegacyRoleId}`;
    if (!uniqueRequirementKeys.has(key)) {
      uniqueRequirementKeys.add(key);
      normalizedRequirements.push({
        guildId: normalizedLegacyGuildId,
        roleId: normalizedLegacyRoleId,
      });
    }
  }

  return normalizedRequirements;
}

function hasAnyRequiredDiscordRole(
  userMe: UserMeResponse,
  requiredDiscordRoles: DiscordRoleRequirement[],
): boolean {
  if (requiredDiscordRoles.length === 0) {
    return true;
  }

  const discordGuildRoles = getDiscordGuildRolesFromUserMe(userMe);
  for (const requirement of requiredDiscordRoles) {
    if (
      discordGuildRoles?.[requirement.guildId]?.includes(requirement.roleId)
    ) {
      return true;
    }
  }

  const roles = userMe.player.roles ?? [];
  for (const requirement of requiredDiscordRoles) {
    if (
      roles.includes(requirement.roleId) ||
      roles.includes(`${requirement.guildId}:${requirement.roleId}`) ||
      roles.includes(`discord:${requirement.guildId}:${requirement.roleId}`)
    ) {
      return true;
    }
  }
  return false;
}

// Worker setup
export async function startWorker() {
  log.info(`Worker starting...`);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const gm = new GameManager(config, log);

  // Initialize lobby service (handles WebSocket upgrade routing)
  const lobbyService = new WorkerLobbyService(server, wss, gm, log);

  setTimeout(
    () => {
      startMatchmakingPolling(gm);
    },
    1000 + Math.random() * 2000,
  );

  if (config.otelEnabled()) {
    initWorkerMetrics(gm);
  }

  const privilegeRefresher = new PrivilegeRefresher(
    config.jwtIssuer() + "/cosmetics.json",
    config.jwtIssuer() + "/profane_words_game_server",
    config.apiKey(),
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

  // Configure MIME types for webp files
  express.static.mime.define({ "image/webp": ["webp"] });

  app.use(express.static(path.join(__dirname, "../../out")));
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

  app.post("/api/create_game/:id", async (req, res) => {
    const id = req.params.id;

    // Extract persistentID from Authorization header token
    // Never accept persistentID directly from client
    let creatorPersistentID: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring("Bearer ".length);
      const result = await verifyClientToken(token, config);
      if (result.type === "success") {
        creatorPersistentID = result.persistentId;
      } else {
        log.warn(`Invalid creator token: ${result.message}`);
        return res.status(401).json({ error: "Invalid creator token" });
      }
    } else if (
      !req.headers[config.adminHeader()] // Public games use admin token instead
    ) {
      return res
        .status(400)
        .json({ error: "Authorization header required to create a game" });
    }

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

    // Pass creatorPersistentID to createGame
    const game = gm.createGame(id, gc, creatorPersistentID);

    log.info(
      `Worker ${workerId}: IP ${ipAnonymize(clientIP)} creating ${game.isPublic() ? "Public" : "Private"}${gc?.gameMode ? ` ${gc.gameMode}` : ""} game with id ${id}${creatorPersistentID ? `, creator: ${creatorPersistentID.substring(0, 8)}...` : ""}`,
    );
    res.json(game.gameInfo());
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
    game.start();
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

  registerGamePreviewRoute({
    app,
    gm,
    config,
    workerId,
    log,
    baseDir: __dirname,
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
        } else if (clientMsg.type !== "join" && clientMsg.type !== "rejoin") {
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
        if (result.type === "error") {
          log.warn(`Invalid token: ${result.message}`, {
            gameID: clientMsg.gameID,
          });
          ws.close(1002, `Unauthorized: invalid token`);
          return;
        }
        const { persistentId, claims } = result;

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

        // Try to reconnect an existing client (e.g., page refresh)
        // If successful, skip all authorization
        if (gm.rejoinClient(ws, persistentId, clientMsg.gameID)) {
          return;
        }

        let roles: string[] | undefined;
        let flares: string[] | undefined;
        let discordId: string | undefined;
        let discordGuildRoles: Record<string, string[]> | undefined;

        // Get the game's Discord allowlist before auth checks
        const gameServer = gm.game(clientMsg.gameID);
        const allowedDiscordIds =
          gameServer?.gameConfig?.allowedDiscordIds ?? [];
        const allowedDiscordIdSet =
          allowedDiscordIds.length > 0 ? new Set(allowedDiscordIds) : null;
        const requiredDiscordRoles = normalizeRequiredDiscordRoles(
          gameServer?.gameConfig?.requiredDiscordRoles,
          gameServer?.gameConfig?.requiredDiscordGuildId,
          gameServer?.gameConfig?.requiredDiscordRoleId,
        );
        const hasRequiredDiscordRoleGate = requiredDiscordRoles.length > 0;

        const allowedFlares = config.allowedFlares();
        if (claims === null) {
          if (allowedFlares !== undefined) {
            log.warn("Unauthorized: Anonymous user attempted to join game");
            ws.close(1002, "Unauthorized");
            return;
          }
          if (allowedDiscordIdSet !== null) {
            log.warn(
              "Unauthorized: Anonymous user attempted to join Discord-restricted game",
              { gameID: clientMsg.gameID },
            );
            ws.close(1002, "Unauthorized: Discord login required");
            return;
          }
          if (hasRequiredDiscordRoleGate) {
            log.warn(
              "Unauthorized: Anonymous user attempted to join role-restricted game",
              { gameID: clientMsg.gameID },
            );
            ws.close(1002, "Unauthorized: Discord role required");
            return;
          }
        } else {
          // Verify token and get player permissions
          const result = await getUserMe(clientMsg.token, config);
          if (result.type === "error") {
            log.warn(`Unauthorized: ${result.message}`, {
              persistentID: persistentId,
              gameID: clientMsg.gameID,
            });
            ws.close(1002, "Unauthorized: user me fetch failed");
            return;
          }
          roles = result.response.player.roles;
          flares = result.response.player.flares;
          discordId = result.response.user.discord?.id;
          discordGuildRoles = getDiscordGuildRolesFromUserMe(result.response);

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

          if (allowedDiscordIdSet !== null) {
            if (!discordId) {
              log.warn(
                "Unauthorized: user without linked Discord attempted to join Discord-restricted game",
                { persistentID: persistentId, gameID: clientMsg.gameID },
              );
              ws.close(1002, "Unauthorized: Discord account required");
              return;
            }
            if (!allowedDiscordIdSet.has(discordId)) {
              log.warn("Unauthorized: Discord ID not in allowlist", {
                persistentID: persistentId,
                gameID: clientMsg.gameID,
              });
              ws.close(1002, "Unauthorized: Discord ID not allowed");
              return;
            }
          }

          if (hasRequiredDiscordRoleGate) {
            if (!discordId) {
              log.warn(
                "Unauthorized: user without linked Discord attempted to join role-restricted game",
                { persistentID: persistentId, gameID: clientMsg.gameID },
              );
              ws.close(1002, "Unauthorized: Discord account required");
              return;
            }
            if (
              !hasAnyRequiredDiscordRole(result.response, requiredDiscordRoles)
            ) {
              log.warn(
                "Unauthorized: user without required Discord role attempted to join game",
                { persistentID: persistentId, gameID: clientMsg.gameID },
              );
              ws.close(1002, "Unauthorized: required Discord role missing");
              return;
            }
          }
        }

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

        if (config.env() !== GameEnv.Dev) {
          const turnstileResult = await verifyTurnstileToken(
            ip,
            clientMsg.turnstileToken,
            config.turnstileSecretKey(),
          );
          switch (turnstileResult.status) {
            case "approved":
              break;
            case "rejected":
              log.warn("Unauthorized: Turnstile token rejected", {
                persistentID: persistentId,
                gameID: clientMsg.gameID,
                reason: turnstileResult.reason,
              });
              ws.close(1002, "Unauthorized: Turnstile token rejected");
              return;
            case "error":
              // Fail open, allow the client to join.
              log.error("Turnstile token error", {
                persistentID: persistentId,
                gameID: clientMsg.gameID,
                reason: turnstileResult.reason,
              });
          }
        }

        // Censor profane usernames server-side (don't reject, just rename)
        const censoredUsername = privilegeRefresher
          .get()
          .censorUsername(clientMsg.username);

        // Create client and add to game
        const client = new Client(
          generateID(),
          persistentId,
          claims,
          roles,
          flares,
          ip,
          censoredUsername,
          clientMsg.username,
          ws,
          cosmeticResult.cosmetics,
          discordId,
          discordGuildRoles,
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
  const PORT = config.workerPortByIndex(workerId);
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
  startPolling(
    async () => {
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
            instanceId: process.env.INSTANCE_ID,
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
          const gameConfig = playlist.get1v1Config();
          const game = gm.createGame(gameId, gameConfig);
          setTimeout(() => {
            // Wait a few seconds to allow clients to connect.
            console.log(`Starting game ${gameId}`);
            game.start();
          }, 7000);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          // Abort is expected if no game is scheduled on this worker.
          return;
        }
        log.error(`Error polling lobby:`, error);
      }
    },
    5000 + Math.random() * 1000,
  );
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
