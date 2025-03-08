import cluster from "cluster";
import http from "http";
import express from "express";
import { GameMapType, GameType, Difficulty } from "../core/game/Game";
import { generateID } from "../core/Util";
import { PseudoRandom } from "../core/PseudoRandom";
import {
  GameEnv,
  getServerConfigFromServer,
} from "../core/configuration/Config";
import { GameInfo } from "../core/Schemas";
import path from "path";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { isHighTrafficTime } from "./Util";
import { gatekeeper, LimiterType } from "./Gatekeeper";

const config = getServerConfigFromServer();
const readyWorkers = new Set();

const app = express();
const server = http.createServer(app);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.json());
app.use(
  express.static(path.join(__dirname, "../../static"), {
    maxAge: "1y", // Set max-age to 1 year for all static assets
    setHeaders: (res, path) => {
      // You can conditionally set different cache times based on file types
      if (path.endsWith(".html")) {
        // HTML files get shorter cache time
        res.setHeader("Cache-Control", "public, max-age=60");
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

  console.log(`Primary ${process.pid} is running`);
  console.log(`Setting up ${config.numWorkers()} workers...`);

  // Fork workers
  for (let i = 0; i < config.numWorkers(); i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
    });

    console.log(`Started worker ${i} (PID: ${worker.process.pid})`);
  }

  cluster.on("message", (worker, message) => {
    if (message.type === "WORKER_READY") {
      const workerId = message.workerId;
      readyWorkers.add(workerId);
      console.log(
        `Worker ${workerId} is ready. (${readyWorkers.size}/${config.numWorkers()} ready)`,
      );
      // Start scheduling when all workers are ready
      if (readyWorkers.size === config.numWorkers()) {
        console.log("All workers ready, starting game scheduling");

        // Safe implementation of dynamic interval
        let timeoutId = null;

        const scheduleLobbies = () => {
          schedulePublicGame()
            .catch((error) => {
              console.error("Error scheduling public game:", error);
            })
            .finally(() => {
              // Schedule next run with the current config value
              const currentLifetime =
                config.gameCreationRate(isHighTrafficTime());
              timeoutId = setTimeout(scheduleLobbies, currentLifetime);
            });
        };

        // Run first execution immediately
        scheduleLobbies();

        // Regular interval for fetching lobbies
        setInterval(() => fetchLobbies(), 250);
      }
    }
  });

  // Handle worker crashes
  cluster.on("exit", (worker, code, signal) => {
    const workerId = (worker as any).process?.env?.WORKER_ID;
    if (!workerId) {
      console.error(`worker crashed could not find id`);
      return;
    }

    console.warn(
      `Worker ${workerId} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`,
    );
    console.log(`Restarting worker ${workerId}...`);

    // Restart the worker with the same ID
    const newWorker = cluster.fork({
      WORKER_ID: workerId,
    });

    console.log(
      `Restarted worker ${workerId} (New PID: ${newWorker.process.pid})`,
    );
  });

  const PORT = 3000;
  server.listen(PORT, () => {
    console.log(`Master HTTP server listening on port ${PORT}`);
  });
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

async function fetchLobbies(): Promise<void> {
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
        console.error(`Error fetching game ${gameID}:`, error);
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
    if (l.msUntilStart <= 250) {
      publicLobbyIDs.delete(l.gameID);
    }
  });

  // Update the JSON string
  publicLobbiesJsonStr = JSON.stringify({
    lobbies: lobbyInfos,
  });
}

// Function to schedule a new public game
async function schedulePublicGame() {
  const gameID = generateID();
  publicLobbyIDs.add(gameID);
  // Create the default public game config (from your GameManager)
  const defaultGameConfig = {
    gameMap: getNextMap(),
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    disableNPCs: false,
    bots: 400,
  };

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
    console.error(
      `Failed to schedule public game on worker ${workerPath}:`,
      error,
    );
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
    World: 4,
    Europe: 4,
    Mena: 2,
    NorthAmerica: 2,
    BlackSea: 2,
    Africa: 2,
    Asia: 2,
    Mars: 2,
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
