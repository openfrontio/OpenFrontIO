import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import crypto from "crypto";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { RateLimiterMemory } from "rate-limiter-flexible";
import * as si from "systeminformation";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import {
  ClientMessage,
  ClientMessageSchema,
  GameRecord,
  GameRecordSchema,
  LogSeverity,
  ServerStartGameMessageSchema,
} from "../core/Schemas";
import { GameEnv, getServerConfig } from "../core/configuration/Config";
import {
  sanitizeUsername,
  validateUsername,
} from "../core/validations/username";
import { archive, gameRecordExists, readGameRecord } from "./Archive";
import { Client } from "./Client";
import { DiscordBot } from "./DiscordBot";
import { GameManager } from "./GameManager";
import { GamePhase } from "./GameServer";
import { slog } from "./StructuredLog";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const serverConfig = getServerConfig();

// Initialize Secret Manager
const secretManager = new SecretManagerServiceClient();

// Discord OAuth Configuration (will be populated from secrets)
let DISCORD_CLIENT_ID: string;
let DISCORD_CLIENT_SECRET: string;

// Serve static files from the 'out' directory
app.use(express.static(path.join(__dirname, "../../out")));
app.use(express.json());

app.set("trust proxy", 2);
app.use(
  rateLimit({
    windowMs: 1000, // 1 second
    max: 20, // 20 requests per IP per second
  }),
);

const rateLimiter = new RateLimiterMemory({
  points: 50, // 50 messages
  duration: 1, // per 1 second
});

const updateRateLimiter = new RateLimiterMemory({
  points: 10,
  duration: 240, // 4 minutes
});

const gm = new GameManager(getServerConfig());

const bot = new DiscordBot();
try {
  await bot.start();
} catch (error) {
  console.error("Failed to start bot:", error);
}

let lobbiesString = "";

// Async error wrapper with rate limiting support
const asyncHandler =
  (fn: Function, limiter = null) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Apply rate limiting if a limiter is provided
      if (limiter) {
        const clientIP = req.ip || req.socket.remoteAddress || "unknown";
        try {
          await limiter.consume(clientIP);
        } catch (error) {
          console.warn(`Rate limited for IP ${clientIP}`);
          return res.status(429).json({ error: "Too many requests" });
        }
      }

      // Execute the route handler
      await fn(req, res, next);
    } catch (error) {
      // Pass any errors to Express error handler
      next(error);
    }
  };

// Discord OAuth callback endpoint
app.get(
  "/auth/callback",
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send("No code provided");
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID!,
        client_secret: DISCORD_CLIENT_SECRET!,
        code: code as string,
        grant_type: "authorization_code",
        redirect_uri: serverConfig.discordRedirectURI(),
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!tokenResponse.ok) {
      throw new Error("Failed to get access token");
    }

    const tokenData = await tokenResponse.json();

    // Get user information
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userResponse.ok) {
      throw new Error("Failed to get user information");
    }

    const userData = await userResponse.json();
    const sessionToken = crypto.randomBytes(32).toString("hex");

    // TODO: store userData and sessionToken in database.

    res.cookie("session", sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
    });
    res.redirect(`/`);
  }),
);

app.get("/auth/discord", (req: Request, res: Response) => {
  console.log("Redirecting to Discord OAuth...");
  const redirectUri = serverConfig.discordRedirectURI();
  const authorizeUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify`;
  console.log("Auth URL:", authorizeUrl);
  res.redirect(authorizeUrl);
});

// New GET endpoint to list lobbies
app.get("/lobbies", (req: Request, res: Response) => {
  res.send(lobbiesString);
});

app.post(
  "/private_lobby",
  asyncHandler(async (req, res) => {
    const clientIP = req.ip || req.socket.remoteAddress || "unknown";
    const id = gm.createPrivateGame();
    console.log(`ip ${clientIP} creating private lobby with id ${id}`);
    res.json({
      id: id,
    });
  }, updateRateLimiter),
);

app.post(
  "/archive_singleplayer_game",
  asyncHandler(async (req, res) => {
    const gameRecord: GameRecord = req.body;
    const clientIP = req.ip || req.socket.remoteAddress || "unknown";

    if (!gameRecord) {
      console.log("game record not found in request");
      res.status(404).json({ error: "Game record not found" });
      return;
    }
    gameRecord.players.forEach((p) => (p.ip = clientIP));
    GameRecordSchema.parse(gameRecord);
    archive(gameRecord);
    res.json({
      success: true,
    });
  }, updateRateLimiter),
);

app.post(
  "/start_private_lobby/:id",
  asyncHandler(async (req, res) => {
    const clientIP = req.ip || req.socket.remoteAddress || "unknown";
    console.log(`starting private lobby with id ${req.params.id}`);
    gm.startPrivateGame(req.params.id);
    res.status(200).json({ success: true });
  }, updateRateLimiter),
);

app.put(
  "/private_lobby/:id",
  asyncHandler(async (req, res) => {
    const lobbyID = req.params.id;
    gm.updateGameConfig(lobbyID, {
      gameMap: req.body.gameMap,
      difficulty: req.body.difficulty,
      infiniteGold: req.body.infiniteGold,
      infiniteTroops: req.body.infiniteTroops,
      instantBuild: req.body.instantBuild,
      bots: req.body.bots,
      disableNPCs: req.body.disableNPCs,
    });
    res.status(200).json({ success: true });
  }),
);

app.get(
  "/lobby/:id/exists",
  asyncHandler(async (req, res) => {
    const lobbyId = req.params.id;
    let gameExists = gm.hasActiveGame(lobbyId);
    if (!gameExists) {
      gameExists = await gameRecordExists(lobbyId);
    }
    res.json({
      exists: gameExists,
    });
  }),
);

app.get(
  "/lobby/:id",
  asyncHandler(async (req, res) => {
    const game = gm.game(req.params.id);
    if (game == null) {
      console.log(`lobby ${req.params.id} not found`);
      return res.status(404).json({ error: "Game not found" });
    }
    res.json({
      players: game.activeClients.map((c) => ({
        username: c.username,
        clientID: c.clientID,
      })),
    });
  }),
);

app.get(
  "/private_lobby/:id",
  asyncHandler(async (req, res) => {
    res.json({
      hi: "5",
    });
  }),
);

app.get(
  "/debug-ip",
  asyncHandler(async (req, res) => {
    res.send({
      "x-forwarded-for": req.headers["x-forwarded-for"],
      "real-ip": req.ip,
      "raw-headers": req.rawHeaders,
    });
  }),
);

app.get("*", function (req, res) {
  // SPA routing
  res.sendFile(path.join(__dirname, "../../out/index.html"));
});

wss.on("connection", (ws, req) => {
  ws.on("message", async (message: string) => {
    let ip = "";
    try {
      const forwarded = req.headers["x-forwarded-for"];
      ip = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded || req.socket.remoteAddress;
      await rateLimiter.consume(ip);
    } catch (error) {
      console.warn(`rate limit exceede for ${ip}`);
      return;
    }
    try {
      const clientMsg: ClientMessage = ClientMessageSchema.parse(
        JSON.parse(message.toString()),
      );
      if (clientMsg.type == "join") {
        const forwarded = req.headers["x-forwarded-for"];
        let ip = Array.isArray(forwarded)
          ? forwarded[0]
          : forwarded || req.socket.remoteAddress;
        if (Array.isArray(ip)) {
          ip = ip[0];
        }
        const { isValid, error } = validateUsername(clientMsg.username);
        if (!isValid) {
          console.log(
            `game ${clientMsg.gameID}, client ${clientMsg.clientID} received invalid username, ${error}`,
          );
          return;
        }
        clientMsg.username = sanitizeUsername(clientMsg.username);
        const wasFound = gm.addClient(
          new Client(
            clientMsg.clientID,
            clientMsg.persistentID,
            ip,
            clientMsg.username,
            ws,
          ),
          clientMsg.gameID,
          clientMsg.lastTurn,
        );
        if (!wasFound) {
          console.log(`game ${clientMsg.gameID} not found, loading from gcs`);
          const record = await readGameRecord(clientMsg.gameID);
          ws.send(
            JSON.stringify(
              ServerStartGameMessageSchema.parse({
                type: "start",
                turns: record.turns,
                config: record.gameConfig,
              }),
            ),
          );
        }
      }
      if (clientMsg.type == "log") {
        slog({
          logKey: "client_console_log",
          msg: clientMsg.log,
          severity: clientMsg.severity,
          clientID: clientMsg.clientID,
          gameID: clientMsg.gameID,
          persistentID: clientMsg.persistentID,
        });
      }
    } catch (error) {
      console.warn(`errror handling websocket message for ${ip}: ${error}`);
    }
  });
  ws.on("error", (error: Error) => {
    if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
      ws.close(1002);
    }
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`Error in ${req.method} ${req.path}:`, err);
  slog({
    logKey: "server_error",
    msg: `Unhandled exception in ${req.method} ${req.path}: ${err.message}`,
    severity: LogSeverity.Error,
    stack: err.stack,
  });
  res.status(500).json({ error: "An unexpected error occurred" });
});

function startServer() {
  setInterval(() => tick(), 1000);
  setInterval(() => updateLobbies(), 100);
  setInterval(async () => {
    await getCurrentCpuUsage();
    console.log("---");
  }, 5 * 1000);

  initializeSecrets();

  const PORT = process.env.PORT || 3000;
  console.log(`Server will try to run on http://localhost:${PORT}`);

  server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

function tick() {
  gm.tick();
}

function updateLobbies() {
  lobbiesString = JSON.stringify({
    lobbies: gm
      .gamesByPhase(GamePhase.Lobby)
      .filter((g) => g.isPublic)
      .map((g) => ({
        id: g.id,
        msUntilStart: g.startTime() - Date.now(),
        numClients: g.numClients(),
        gameConfig: g.gameConfig,
      }))
      .sort((a, b) => a.msUntilStart - b.msUntilStart),
  });
}

// Process-level unhandled exception handlers
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  slog({
    logKey: "uncaught_exception",
    msg: `Uncaught exception: ${err.message}`,
    severity: LogSeverity.Error,
    stack: err.stack,
  });
  // Note: We're not exiting the process to maintain uptime
  // but be aware the app might be in an inconsistent state
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  slog({
    logKey: "unhandled_rejection",
    msg: `Unhandled promise rejection: ${reason}`,
    severity: LogSeverity.Error,
  });
});

// Initialize secrets and start server
async function initializeSecrets() {
  try {
    DISCORD_CLIENT_ID = await getSecret(
      "DISCORD_CLIENT_ID",
      serverConfig.env(),
    );
    DISCORD_CLIENT_SECRET = await getSecret(
      "DISCORD_CLIENT_SECRET",
      serverConfig.env(),
    );

    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
      throw new Error("Failed to load Discord secrets");
    }
  } catch (error) {
    console.error("Failed to initialize secrets:", error);
  }
}

async function getSecret(secretName: string, ge: GameEnv) {
  if (ge == GameEnv.Dev) {
    console.log(`loading secret ${secretName} from environment variable`);
    const value = process.env[secretName];
    if (!value) {
      throw Error(`error loading secret ${secretName}`);
    }
  }
  console.log(`loading secret ${secretName} from Google secrets manager`);
  const name = `projects/openfrontio/secrets/${secretName}/versions/latest`;
  const [version] = await secretManager.accessSecretVersion({ name });
  return version.payload?.data?.toString();
}

async function getCurrentCpuUsage(): Promise<void> {
  const cpuData = await si.currentLoad();
  console.log(`Current CPU Load: ${cpuData.currentLoad.toFixed(2)}%`);
  console.log(
    `Current CPU Load (User): ${cpuData.currentLoadUser.toFixed(2)}%`,
  );
  console.log(
    `Current CPU Load (System): ${cpuData.currentLoadSystem.toFixed(2)}%`,
  );
}

startServer();
