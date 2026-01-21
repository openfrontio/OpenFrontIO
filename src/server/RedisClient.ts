import cluster from "cluster";
import Redis from "ioredis";
import { GameConfig } from "../core/Schemas";
import { logger } from "./Logger";

const log = logger.child({ comp: "redis" });

const isDevMode = process.env.GAME_ENV === "dev";

let redis: Redis;
let redisReady: Promise<void>;

if (isDevMode) {
  // In dev mode, master starts redis-memory-server and shares host/port with workers
  if (cluster.isPrimary) {
    // Master: start redis-memory-server and set env vars for workers
    redisReady = (async () => {
      const { RedisMemoryServer } = await import("redis-memory-server");
      const redisServer = new RedisMemoryServer();
      const host = await redisServer.getHost();
      const port = await redisServer.getPort();
      log.info(`Started Redis memory server at ${host}:${port}`);

      // Set env vars so workers can connect
      process.env.REDIS_HOST = host;
      process.env.REDIS_PORT = String(port);

      redis = new Redis({
        host,
        port,
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      redis.on("error", (err) => {
        log.error("Redis connection error:", err);
      });

      redis.on("connect", () => {
        log.info("Connected to Redis memory server");
      });
    })();
  } else {
    // Worker: connect to Redis using env vars set by master
    const host = process.env.REDIS_HOST ?? "127.0.0.1";
    const port = parseInt(process.env.REDIS_PORT ?? "6379");

    redis = new Redis({
      host,
      port,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redis.on("error", (err) => {
      log.error("Redis connection error:", err);
    });

    redis.on("connect", () => {
      log.info(`Worker connected to Redis memory server at ${host}:${port}`);
    });

    redisReady = Promise.resolve();
  }
} else {
  // In production, connect to real Redis
  redis = new Redis({
    host: "127.0.0.1",
    port: 6379,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  redis.on("error", (err) => {
    log.error("Redis connection error:", err);
  });

  redis.on("connect", () => {
    log.info("Connected to Redis");
  });

  redisReady = Promise.resolve();
}

export interface PendingGame {
  gameID: string;
  gameConfig: GameConfig;
  createdAt: number;
}

const PENDING_GAMES_KEY = "pending_games";

export async function addPendingGame(
  gameID: string,
  gameConfig: GameConfig,
): Promise<void> {
  await redisReady;
  const pendingGame: PendingGame = {
    gameID,
    gameConfig,
    createdAt: Date.now(),
  };
  await redis.hset(PENDING_GAMES_KEY, gameID, JSON.stringify(pendingGame));
}

export async function getPendingGamesForWorker(
  workerIndex: (gameID: string) => number,
  workerId: number,
): Promise<PendingGame[]> {
  await redisReady;
  const allGames = await redis.hgetall(PENDING_GAMES_KEY);
  const games: PendingGame[] = [];

  for (const [gameID, value] of Object.entries(allGames)) {
    if (workerIndex(gameID) === workerId) {
      try {
        games.push(JSON.parse(value) as PendingGame);
      } catch (e) {
        log.error(`Failed to parse pending game ${gameID}:`, e);
      }
    }
  }

  return games;
}

export async function removePendingGame(gameID: string): Promise<void> {
  await redisReady;
  await redis.hdel(PENDING_GAMES_KEY, gameID);
}

// Public lobby IDs - Master writes these, workers read them
const PUBLIC_LOBBY_IDS_KEY = "public_lobby_ids";

export async function addPublicLobbyID(gameID: string): Promise<void> {
  await redisReady;
  await redis.sadd(PUBLIC_LOBBY_IDS_KEY, gameID);
}

export async function removePublicLobbyID(gameID: string): Promise<void> {
  await redisReady;
  await redis.srem(PUBLIC_LOBBY_IDS_KEY, gameID);
}

export async function getPublicLobbyIDs(): Promise<string[]> {
  await redisReady;
  return redis.smembers(PUBLIC_LOBBY_IDS_KEY);
}

// Live lobby info - workers write their game state here
const LOBBY_INFO_KEY = "lobby_info";

export interface LobbyInfo {
  gameID: string;
  numClients: number;
  msUntilStart?: number;
  gameConfig?: unknown;
  updatedAt: number;
}

export async function setLobbyInfo(info: LobbyInfo): Promise<void> {
  await redisReady;
  await redis.hset(LOBBY_INFO_KEY, info.gameID, JSON.stringify(info));
}

export async function removeLobbyInfo(gameID: string): Promise<void> {
  await redisReady;
  await redis.hdel(LOBBY_INFO_KEY, gameID);
}

export async function getAllLobbyInfo(): Promise<LobbyInfo[]> {
  await redisReady;
  const allInfo = await redis.hgetall(LOBBY_INFO_KEY);
  const lobbies: LobbyInfo[] = [];
  const now = Date.now();

  for (const [gameID, value] of Object.entries(allInfo)) {
    try {
      const info = JSON.parse(value) as LobbyInfo;
      // Skip stale entries (older than 5 seconds)
      if (now - info.updatedAt > 5000) {
        await redis.hdel(LOBBY_INFO_KEY, gameID);
        continue;
      }
      lobbies.push(info);
    } catch (e) {
      log.error(`Failed to parse lobby info ${gameID}:`, e);
    }
  }

  return lobbies;
}

export { redis };

// Returns Redis connection info after it's ready (for master to pass to workers)
export async function getRedisConnectionInfo(): Promise<{
  host: string;
  port: number;
}> {
  await redisReady;
  return {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT ?? "6379"),
  };
}
