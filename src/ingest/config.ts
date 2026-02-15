export interface IngestConfig {
  port: number;
  targetBaseUrl: string;
  targetWsUrl: string;
  archiveApiBase: string | null;
  dbPath: string;
  reconnectDelayMs: number;
  numWorkers: number;
  gameInfoPollMs: number;
  closureProbeAttempts: number;
  closureProbeIntervalMs: number;
}

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
};

const envString = (name: string, fallback: string): string => {
  const raw = process.env[name];
  return raw && raw.length > 0 ? raw : fallback;
};

const trimSlash = (value: string): string => value.replace(/\/+$/, "");

export function loadConfig(): IngestConfig {
  const numWorkers = Math.max(1, envInt("NUM_WORKERS", 20));
  const targetBaseUrl = trimSlash(
    envString("TARGET_BASE_URL", "https://openfront.io"),
  );
  const wsBase = targetBaseUrl.replace(/^http/i, "ws");
  const wsDefault = `${wsBase}/lobbies`;
  return {
    port: envInt("PORT", 3100),
    targetBaseUrl,
    targetWsUrl: envString("TARGET_WS_URL", wsDefault),
    archiveApiBase: trimSlash(
      envString("ARCHIVE_API_BASE", "https://api.openfront.io"),
    ),
    dbPath: envString("DB_PATH", "data/db.json"),
    reconnectDelayMs: envInt("RECONNECT_DELAY_MS", 3000),
    numWorkers,
    gameInfoPollMs: Math.max(1000, envInt("GAME_INFO_POLL_MS", 5000)),
    closureProbeAttempts: Math.max(1, envInt("CLOSURE_PROBE_ATTEMPTS", 20)),
    closureProbeIntervalMs: Math.max(
      1000,
      envInt("CLOSURE_PROBE_INTERVAL_MS", 3000),
    ),
  };
}
