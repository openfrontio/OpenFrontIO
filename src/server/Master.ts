import cluster from "cluster";
import http from "http";
import express from "express";
import { GameMapType, GameType, Difficulty } from "../core/game/Game";
import { generateID } from "../core/Util";
import { PseudoRandom } from "../core/PseudoRandom";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameConfig, GameInfo } from "../core/Schemas";
import path from "path";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { gatekeeper, LimiterType } from "./Gatekeeper";
import { setupMetricsServer } from "./MasterMetrics";
import { logger } from "./Logger";

const config = getServerConfigFromServer();
const readyWorkers = new Set();

const app = express();
const server = http.createServer(app);

// Create a separate metrics server on port 9090
const metricsApp = express();
const metricsServer = http.createServer(metricsApp);

const log = logger.child({ component: "Master" });

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

const publicLobbyIDs: Set<string> = new Set();

// Start the master process
export async function startMaster() {
  if (!cluster.isPrimary) {
    throw new Error(
      "startMaster() should only be called in the primary process",
    );
  }

  log.info(`Primary ${process.pid} is running`);
  log.info(`Setting up ${config.numWorkers()} workers...`);

  // Fork workers
  for (let i = 0; i < config.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
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
          schedulePublicGame().catch((error) => {
            log.error("Error scheduling public game:", error);
          });
        };

        setInterval(
          () =>
            fetchLobbies().then((lobbies) => {
              if (lobbies == 0) {
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
    });

    log.info(
      `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
    );
  });

  const PORT = 3000;
  server.listen(PORT, () => {
    log.info(`Master HTTP server listening on port ${PORT}`);
  });

  // Setup the metrics server
  setupMetricsServer();
}

app.get(
  "/api/env",
  gatekeeper.httpHandler(LimiterType.Get, async (req, res) => {
    const envConfig = {
      game_env: process.env.GAME_ENV || "prod",
    };
    res.json(envConfig);
  }),
);

// Add lobbies endpoint to list public games for this worker
app.get(
  "/api/public_lobbies",
  gatekeeper.httpHandler(LimiterType.Get, async (req, res) => {
    res.send(publicLobbiesJsonStr);
  }),
);

async function fetchLobbies(): Promise<number> {
  const fetchPromises = [];

  for (const gameID of publicLobbyIDs) {
    const port = config.workerPort(gameID);
    const promise = fetch(`http://localhost:${port}/api/game/${gameID}`, {
      headers: { [config.adminHeader()]: config.adminToken() },
    })
      .then((resp) => resp.json())
      .then((json) => {
        return json as GameInfo;
      })
      .catch((error) => {
        log.error(`Error fetching game ${gameID}:`, error);
        // Return null or a placeholder if fetch fails
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
    if (l.msUntilStart <= 250 || l.gameConfig.maxPlayers <= l.numClients) {
      publicLobbyIDs.delete(l.gameID);
    }
  });

  // Update the JSON string
  publicLobbiesJsonStr = JSON.stringify({
    lobbies: lobbyInfos,
  });

  return publicLobbyIDs.size;
}

// Function to schedule a new public game
async function schedulePublicGame() {
  const gameID = generateID();
  const map = getNextMap();
  publicLobbyIDs.add(gameID);
  // Create the default public game config (from your GameManager)
  const defaultGameConfig = {
    gameMap: map,
    maxPlayers: config.lobbyMaxPlayers(map),
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    disableNPCs: false,
    disableNukes: false,
    bots: 400,
  } as GameConfig;

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
        body: JSON.stringify({
          gameConfig: defaultGameConfig,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to schedule public game: ${response.statusText}`);
    }

    const data = await response.json();
  } catch (error) {
    log.error(`Failed to schedule public game on worker ${workerPath}:`, error);
    throw error;
  }
}

// Map rotation management (moved from GameManager)
const mapsPlaylist: GameMapType[] = [];
const random = new PseudoRandom(123);

// Get the next map in rotation
function getNextMap(): GameMapType {
  if (mapsPlaylist.length > 0) {
    return mapsPlaylist.shift()!;
  }

  const frequency = {
    World: 3,
    Europe: 3,
    Mena: 2,
    NorthAmerica: 2,
    BlackSea: 2,
    Africa: 2,
    Asia: 2,
    Mars: 2,
    Britannia: 2,
    GatewayToTheAtlantic: 2,
  };

  Object.keys(GameMapType).forEach((key) => {
    let count = parseInt(frequency[key]);

    while (count > 0) {
      mapsPlaylist.push(GameMapType[key]);
      count--;
    }
  });

  while (true) {
    random.shuffleArray(mapsPlaylist);
    if (allNonConsecutive(mapsPlaylist)) {
      return mapsPlaylist.shift()!;
    }
  }
}

// Check for consecutive duplicates in the maps array
function allNonConsecutive(maps: GameMapType[]): boolean {
  for (let i = 0; i < maps.length - 1; i++) {
    if (maps[i] === maps[i + 1]) {
      return false;
    }
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SPA fallback route
app.get("*", function (req, res) {
  res.sendFile(path.join(__dirname, "../../static/index.html"));
});
