import cluster from "cluster";
import crypto from "crypto";
import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameInfo, ID } from "../core/Schemas";
import { generateID } from "../core/Util";
import {
  ExternalGameInfo,
  buildPreview,
  renderPreview,
} from "./GamePreviewBuilder";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";

const config = getServerConfigFromServer();
const playlist = new MapPlaylist();

const BOT_USER_AGENTS = [
  "discordbot",
  "twitterbot",
  "slackbot",
  "facebookexternalhit",
  "linkedinbot",
  "telegrambot",
  "applebot",
  "snapchat",
  "whatsapp",
  "pinterestbot",
];

const joinPreviewLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 100, // limit each IP to 100 requests per windowMs
  skip: (req) => {
    const ua = req.get("user-agent")?.toLowerCase() ?? "";
    return BOT_USER_AGENTS.some((bot) => ua.includes(bot));
  },
});

const readyWorkers = new Set();

const app = express();
const server = http.createServer(app);

const log = logger.child({ comp: "m" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.json());

const isBotRequest = (req: Request): boolean => {
  const ua = req.get("user-agent")?.toLowerCase() ?? "";
  return BOT_USER_AGENTS.some((token) => ua.includes(token));
};

const requestOrigin = (req: Request): string => {
  const protoHeader = (req.headers["x-forwarded-proto"] as string) ?? "";
  const proto = protoHeader.split(",")[0]?.trim() || req.protocol || "https";
  const host = req.get("host") ?? `${config.subdomain()}.${config.domain()}`;
  return `${proto}://${host}`;
};

const fetchLobbyInfo = async (gameID: string): Promise<GameInfo | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const workerPort = config.workerPort(gameID);
    const response = await fetch(
      `http://127.0.0.1:${workerPort}/api/game/${gameID}`,
      {
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as GameInfo;
    return data;
  } catch (error) {
    log.warn("failed to fetch lobby info", { gameID, error });
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const fetchPublicGameInfo = async (
  gameID: string,
): Promise<ExternalGameInfo | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const apiDomain = process.env.API_DOMAIN ?? `api.${config.domain()}`;
    const response = await fetch(`https://${apiDomain}/game/${gameID}`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as ExternalGameInfo;
  } catch (error) {
    log.warn("failed to fetch public game info", { gameID, error });
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const serveJoinPreview = async (
  req: Request,
  res: Response,
  gameID: string,
): Promise<void> => {
  const parsed = ID.safeParse(gameID);
  if (!parsed.success) {
    res.redirect(302, "/");
    return;
  }

  const joinId = parsed.data;
  const origin = requestOrigin(req);
  const botRequest = isBotRequest(req);
  const [lobby, publicInfo] = await Promise.all([
    fetchLobbyInfo(joinId),
    fetchPublicGameInfo(joinId),
  ]);

  if (botRequest) {
    const meta = buildPreview(joinId, origin, lobby, publicInfo);
    const html = renderPreview(meta, joinId, true);

    // Determine if public or private lobby
    const isPrivate = lobby?.gameConfig?.gameType === "Private";
    const isFinished = !!publicInfo?.info?.end;

    if (isPrivate) {
      // Private lobby: shorter cache (10 seconds), ETag based on settings
      const settingsHash = JSON.stringify(lobby?.gameConfig);
      const etag = crypto
        .createHash("sha256")
        .update(settingsHash)
        .digest("hex");
      res
        .status(200)
        .setHeader("Cache-Control", "public, max-age=10")
        .setHeader("ETag", `"${etag}"`)
        .type("html")
        .send(html);
    } else {
      // Public lobby: longer cache (60 seconds), ETag based on gamestate
      const gamestateHash = isFinished
        ? JSON.stringify(publicInfo?.info)
        : JSON.stringify(lobby);
      const etag = crypto
        .createHash("sha256")
        .update(gamestateHash)
        .digest("hex");
      res
        .status(200)
        .setHeader("Cache-Control", "public, max-age=60")
        .setHeader("ETag", `"${etag}"`)
        .type("html")
        .send(html);
    }
    return;
  }

  res.sendFile(path.join(__dirname, "../../static/index.html"));
};

app.get("/game/:gameId", joinPreviewLimiter, (req, res) => {
  serveJoinPreview(req, res, req.params.gameId).catch((error) => {
    log.error("failed to render join preview", { error });
    res.status(500).send("Unable to render lobby preview");
  });
});

app.use(
  "/maps",
  express.static(path.join(__dirname, "../../resources/maps"), {
    maxAge: "1y",
  }),
);

app.use(
  express.static(path.join(__dirname, "../../static"), {
    maxAge: "1y", // Set max-age to 1 year for all static assets
    setHeaders: (res, path) => {
      // You can conditionally set different cache times based on file types
      if (path.endsWith(".html")) {
        // Set HTML files to no-cache to ensure Express doesn't send 304s
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        );
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        // Prevent conditional requests
        res.setHeader("ETag", "");
      } else if (path.match(/\.(js|css|svg)$/)) {
        // JS, CSS, SVG get long cache with immutable
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (path.match(/\.(bin|dat|exe|dll|so|dylib)$/)) {
        // Binary files also get long cache with immutable
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      // Other file types use the default maxAge setting
    },
  }),
);
app.use(express.json());

app.set("trust proxy", 3);
app.use(
  rateLimit({
    windowMs: 1000, // 1 second
    max: 20, // 20 requests per IP per second
  }),
);

let publicLobbiesData: { lobbies: GameInfo[] } = { lobbies: [] };

const publicLobbyIDs: Set<string> = new Set();
const connectedClients: Set<WebSocket> = new Set();

// Broadcast lobbies to all connected clients
function broadcastLobbies() {
  const message = JSON.stringify({
    type: "lobbies_update",
    data: publicLobbiesData,
  });

  const clientsToRemove: WebSocket[] = [];

  connectedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    } else {
      clientsToRemove.push(client);
    }
  });

  clientsToRemove.forEach((client) => {
    connectedClients.delete(client);
  });
}

// Start the master process
export async function startMaster() {
  if (!cluster.isPrimary) {
    throw new Error(
      "startMaster() should only be called in the primary process",
    );
  }

  log.info(`Primary ${process.pid} is running`);
  log.info(`Setting up ${config.numWorkers()} workers...`);

  // Setup WebSocket server for clients
  const wss = new WebSocketServer({ server, path: "/lobbies" });

  wss.on("connection", (ws: WebSocket) => {
    connectedClients.add(ws);

    // Send current lobbies immediately (always send, even if empty)
    ws.send(
      JSON.stringify({ type: "lobbies_update", data: publicLobbiesData }),
    );

    ws.on("close", () => {
      connectedClients.delete(ws);
    });

    ws.on("error", (error) => {
      log.error(`WebSocket error:`, error);
      connectedClients.delete(ws);
      try {
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close(1011, "WebSocket internal error");
        }
      } catch (closeError) {
        log.error("Error while closing WebSocket after error:", closeError);
      }
    });
  });

  // Generate admin token for worker authentication
  const ADMIN_TOKEN = crypto.randomBytes(16).toString("hex");
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;

  // Fork workers
  for (let i = 0; i < config.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
      ADMIN_TOKEN,
    });

    log.info(`Started worker ${i} (PID: ${worker.process.pid})`);
  }

  cluster.on("message", (worker, message) => {
    if (message.type === "WORKER_READY") {
      const workerId = message.workerId;
      readyWorkers.add(workerId);
      log.info(
        `Worker ${workerId} is ready. (${readyWorkers.size}/${config.numWorkers()} ready)`,
      );
      // Start scheduling when all workers are ready
      if (readyWorkers.size === config.numWorkers()) {
        log.info("All workers ready, starting game scheduling");

        const scheduleLobbies = () => {
          schedulePublicGame(playlist).catch((error) => {
            log.error("Error scheduling public game:", error);
          });
        };

        setInterval(
          () =>
            fetchLobbies().then((lobbies) => {
              if (lobbies === 0) {
                scheduleLobbies();
              }
            }),
          100,
        );
      }
    }
  });

  // Handle worker crashes
  cluster.on("exit", (worker, code, signal) => {
    const workerId = (worker as any).process?.env?.WORKER_ID;
    if (!workerId) {
      log.error(`worker crashed could not find id`);
      return;
    }

    log.warn(
      `Worker ${workerId} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`,
    );
    log.info(`Restarting worker ${workerId}...`);

    // Restart the worker with the same ID
    const newWorker = cluster.fork({
      WORKER_ID: workerId,
      ADMIN_TOKEN,
    });

    log.info(
      `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
    );
  });

  const PORT = 3000;
  server.listen(PORT, () => {
    log.info(`Master HTTP server listening on port ${PORT}`);
  });
}

app.get("/api/env", async (req, res) => {
  const envConfig = {
    game_env: process.env.GAME_ENV,
  };
  if (!envConfig.game_env) return res.sendStatus(500);
  res.json(envConfig);
});

// Add lobbies endpoint to list public games for this worker
app.get("/api/public_lobbies", async (req, res) => {
  res.json(publicLobbiesData);
});

async function fetchLobbies(): Promise<number> {
  const fetchPromises: Promise<GameInfo | null>[] = [];

  for (const gameID of new Set(publicLobbyIDs)) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000); // 5 second timeout
    const port = config.workerPort(gameID);
    const promise = fetch(`http://localhost:${port}/api/game/${gameID}`, {
      headers: { [config.adminHeader()]: config.adminToken() },
      signal: controller.signal,
    })
      .then((resp) => resp.json())
      .then((json) => {
        return json as GameInfo;
      })
      .catch((error) => {
        log.error(`Error fetching game ${gameID}:`, error);
        // Return null or a placeholder if fetch fails
        publicLobbyIDs.delete(gameID);
        return null;
      });

    fetchPromises.push(promise);
  }

  // Wait for all promises to resolve
  const results = await Promise.all(fetchPromises);

  // Filter out any null results from failed fetches
  const lobbyInfos: GameInfo[] = results
    .filter((result) => result !== null)
    .map((gi: GameInfo) => {
      return {
        gameID: gi.gameID,
        numClients: gi?.clients?.length ?? 0,
        gameConfig: gi.gameConfig,
        msUntilStart: (gi.msUntilStart ?? Date.now()) - Date.now(),
      } as GameInfo;
    });

  lobbyInfos.forEach((l) => {
    if (
      "msUntilStart" in l &&
      l.msUntilStart !== undefined &&
      l.msUntilStart <= 250
    ) {
      publicLobbyIDs.delete(l.gameID);
      return;
    }

    if (
      "gameConfig" in l &&
      l.gameConfig !== undefined &&
      "maxPlayers" in l.gameConfig &&
      l.gameConfig.maxPlayers !== undefined &&
      "numClients" in l &&
      l.numClients !== undefined &&
      l.gameConfig.maxPlayers <= l.numClients
    ) {
      publicLobbyIDs.delete(l.gameID);
      return;
    }
  });

  // Update the lobbies data
  publicLobbiesData = {
    lobbies: lobbyInfos,
  };

  broadcastLobbies();

  return publicLobbyIDs.size;
}

// Function to schedule a new public game
async function schedulePublicGame(playlist: MapPlaylist) {
  const gameID = generateID();
  publicLobbyIDs.add(gameID);

  const workerPath = config.workerPath(gameID);

  // Send request to the worker to start the game
  try {
    const response = await fetch(
      `http://localhost:${config.workerPort(gameID)}/api/create_game/${gameID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [config.adminHeader()]: config.adminToken(),
        },
        body: JSON.stringify(playlist.gameConfig()),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to schedule public game: ${response.statusText}`);
    }
  } catch (error) {
    log.error(`Failed to schedule public game on worker ${workerPath}:`, error);
    throw error;
  }
}

// SPA fallback route
app.get("*", function (req, res) {
  res.sendFile(path.join(__dirname, "../../static/index.html"));
});
