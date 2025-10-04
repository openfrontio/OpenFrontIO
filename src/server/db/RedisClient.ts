import Redis from "ioredis";

let client: Redis | null = null;

export function hasRedisConfig(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) {
    return null;
  }
  if (client) {
    return client;
  }
  client = new Redis(process.env.REDIS_URL, {
    enableAutoPipelining: true,
    maxRetriesPerRequest: 2,
  });
  client.on("error", (err) => {
    console.error("Redis error", err);
  });
  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (!client) {
    return;
  }
  await client.quit();
  client = null;
}
