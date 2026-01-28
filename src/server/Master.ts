import cluster from "cluster";
import crypto from "crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameInfo } from "../core/Schemas";
import { LobbyScheduler } from "./LobbyScheduler";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { startPolling } from "./PollingLoop";
import { renderHtml } from "./RenderHtml";

const config = getServerConfigFromServer();
const playlist = new MapPlaylist();
const readyWorkers = new Set();

const app = express();
const server = http.createServer(app);

const log = logger.child({ comp: "m" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

// Middleware to handle HTML files with EJS templating
app.use(async (req, res, next) => {
  if (req.path === "/") {
    try {
      await renderHtml(res, path.join(__dirname, "../../static/index.html"));
    } catch (error) {
      log.error("Error rendering index.html:", error);
      res.status(500).send("Internal Server Error");
    }
  } else {
    next();
  }
});

app.use(
  express.static(path.join(__dirname, "../../static"), {
    maxAge: "1y", // Set max-age to 1 year for all static assets
    setHeaders: (res, path) => {
      // You can conditionally set different cache times based on file types
      if (path.match(/\.(js|css|svg)$/)) {
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

app.set("trust proxy", 3);
app.use(
  rateLimit({
    windowMs: 1000, // 1 second
    max: 20, // 20 requests per IP per second
  }),
);

let publicLobbiesData: { lobbies: GameInfo[] } = { lobbies: [] };

const connectedClients: Set<WebSocket> = new Set();
const lobbyScheduler = new LobbyScheduler(config, playlist, log, (lobbies) => {
  publicLobbiesData = { lobbies };
  broadcastLobbies();
});

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

  const INSTANCE_ID =
    config.env() === GameEnv.Dev
      ? "DEV_ID"
      : crypto.randomBytes(4).toString("hex");
  process.env.INSTANCE_ID = INSTANCE_ID;

  log.info(`Instance ID: ${INSTANCE_ID}`);

  // Fork workers
  for (let i = 0; i < config.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
      ADMIN_TOKEN,
      INSTANCE_ID,
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

        startPolling(async () => {
          await lobbyScheduler.ensureCategoryCoverage();
        }, 500);
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
      INSTANCE_ID,
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

// SPA fallback route
app.get("*", async function (_req, res) {
  try {
    const htmlPath = path.join(__dirname, "../../static/index.html");
    await renderHtml(res, htmlPath);
  } catch (error) {
    log.error("Error rendering SPA fallback:", error);
    res.status(500).send("Internal Server Error");
  }
});
