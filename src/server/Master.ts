import express from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameInfo } from "../core/Schemas";
import { gatekeeper, LimiterType } from "./Gatekeeper";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { WorkerDiscoveryService } from "./WorkerDiscoveryService";

const config = getServerConfigFromServer();
const playlist = new MapPlaylist();
const workerDiscovery = new WorkerDiscoveryService();

const app = express();
const server = http.createServer(app);

const log = logger.child({ comp: "m" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.json());
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

let publicLobbiesJsonStr = "";

interface PublicLobby {
  gameID: string;
  dns: string;
}

const publicLobbies: Map<string, PublicLobby> = new Map();

// Start the master process
export async function startMaster() {
  const PORT = 3000;
  server.listen(PORT, () => {
    log.info(`Master HTTP server listening on port ${PORT}`);
  });

  const scheduleLobbies = () => {
    schedulePublicGame(playlist).catch((error) => {
      log.error("Error scheduling public game:", error);
    });
  };

  // Wait for the workers to start
  sleep(5 * 1000).then(() => {
    setInterval(
      () =>
        fetchLobbies().then((lobbies) => {
          if (lobbies === 0) {
            scheduleLobbies();
          }
        }),
      100, // TODO: set this back to 100
    );
  });
}

app.get(
  "/api/env",
  gatekeeper.httpHandler(LimiterType.Get, async (req, res) => {
    res.status(200).json({
      game_env: process.env.GAME_ENV || "prod",
      subdomain: config.subdomain(),
      domain: config.domain(),
    });
  }),
);

// Add lobbies endpoint to list public games for this worker
app.get(
  "/api/public_lobbies",
  gatekeeper.httpHandler(LimiterType.Get, async (req, res) => {
    res.send(publicLobbiesJsonStr);
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

    try {
      const response = await fetch(
        `http://localhost:${config.workerPort(gameID)}/api/kick_player/${gameID}/${clientID}`,
        {
          method: "POST",
          headers: {
            [config.adminHeader()]: config.adminToken(),
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to kick player: ${response.statusText}`);
      }

      res.status(200).send("Player kicked successfully");
    } catch (error) {
      log.error(`Error kicking player from game ${gameID}:`, error);
      res.status(500).send("Failed to kick player");
    }
  }),
);

app.post(
  "/api/worker_heartbeat",
  gatekeeper.httpHandler(LimiterType.Post, async (req, res) => {
    log.info(`Received heartbeat from ${req.body.dns}...`);
    if (req.headers[config.adminHeader()] !== config.adminToken()) {
      res.status(401).send("Unauthorized");
      return;
    }

    const { workerId, dns, activeClients } = req.body;

    if (!workerId || !dns || typeof activeClients !== "number") {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    workerDiscovery.updateWorkerHeartbeat(workerId, dns, activeClients);
    res.status(200).json({ success: true });
  }),
);

app.get(
  "/api/worker_address",
  gatekeeper.httpHandler(LimiterType.Post, async (req, res) => {
    const worker = workerDiscovery.getAvailableWorker();
    if (!worker) {
      res.status(500).json({ error: "No available workers" });
      return;
    }
    res.status(200).json({ dns: worker.dns });
  }),
);

async function fetchLobbies(): Promise<number> {
  const fetchPromises: Promise<GameInfo | null>[] = [];

  for (const lobby of publicLobbies.values()) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000); // 5 second timeout
    const promise = fetch(`${lobby.dns}/api/game/${lobby.gameID}`, {
      headers: { [config.adminHeader()]: config.adminToken() },
      signal: controller.signal,
    })
      .then((resp) => resp.json())
      .then((json) => {
        return json as GameInfo;
      })
      .catch((error) => {
        log.error(`Error fetching game ${lobby.gameID}:`, error);
        // Return null or a placeholder if fetch fails
        publicLobbies.delete(lobby.gameID);
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
      publicLobbies.delete(l.gameID);
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
      publicLobbies.delete(l.gameID);
      return;
    }
  });

  // Update the JSON string
  publicLobbiesJsonStr = JSON.stringify({
    lobbies: lobbyInfos,
  });

  return publicLobbies.size;
}

// Function to schedule a new public game
async function schedulePublicGame(playlist: MapPlaylist) {
  const dns = workerDiscovery.getAvailableWorker().dns;
  log.info(`Scheduling public game on worker ${dns}...`);

  // Send request to the worker to start the game
  try {
    const response = await fetch(`${dns}/api/create_game`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [config.adminHeader()]: config.adminToken(),
      },
      body: JSON.stringify(playlist.gameConfig()),
    });

    if (!response.ok) {
      throw new Error(`Failed to schedule public game: ${response.statusText}`);
    }

    const data = await response.json();
    publicLobbies.set(data.gameID, {
      gameID: data.gameID,
      dns,
    });
  } catch (error) {
    log.error(`Failed to schedule public game on worker ${dns}:`, error);
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SPA fallback route
app.get("*", function (req, res) {
  res.sendFile(path.join(__dirname, "../../static/index.html"));
});
