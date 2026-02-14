import crypto from "crypto";
import { GameEnv, ServerConfig } from "../core/configuration/Config";
import { Env } from "../core/configuration/Env";

const DEFAULT_MASTER_PORT = 3000;
const DEFAULT_WORKER_BASE_PORT = 3001;
const DEFAULT_WORKER_ID = 0;
const DEV_INSTANCE_ID = "DEV_ID";

type RuntimeRole = "master" | "worker";

export interface MasterSessionConfig {
  adminToken: string;
  instanceId: string;
}

export interface RuntimeConfigSnapshot {
  role: RuntimeRole;
  pid: number;
  gameEnv: string;
  numWorkers: number;
  masterPort: number;
  workerBasePort: number;
  workerPortRange: {
    start: number;
    end: number;
  };
  workerId?: number;
  workerPort?: number;
  instanceId?: string;
  domain: string;
  subdomain: string;
  jwtIssuer: string;
  controlPlaneUrl?: string;
}

const normalizeString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
};

const parseNonNegativeInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export function gameEnvName(gameEnv: GameEnv): string {
  switch (gameEnv) {
    case GameEnv.Dev:
      return "dev";
    case GameEnv.Preprod:
      return "staging";
    case GameEnv.Prod:
      return "prod";
    default:
      return "unknown";
  }
}

export function resolvedGameEnvName(): string {
  return normalizeString(Env.GAME_ENV) ?? "dev";
}

export function resolvedMasterPort(): number {
  return parseNonNegativeInt(Env.MASTER_PORT, DEFAULT_MASTER_PORT);
}

export function resolvedWorkerBasePort(): number {
  return parseNonNegativeInt(Env.WORKER_BASE_PORT, DEFAULT_WORKER_BASE_PORT);
}

export function resolvedWorkerId(): number {
  return parseNonNegativeInt(Env.WORKER_ID, DEFAULT_WORKER_ID);
}

export function resolvedInstanceId(): string | undefined {
  return normalizeString(Env.INSTANCE_ID);
}

export function resolvedControlPlaneUrl(): string | undefined {
  return normalizeString(Env.CONTROL_PLANE_URL);
}

export function createMasterSessionConfig(config: ServerConfig): MasterSessionConfig {
  return {
    adminToken: crypto.randomBytes(16).toString("hex"),
    instanceId:
      config.env() === GameEnv.Dev
        ? DEV_INSTANCE_ID
        : crypto.randomBytes(4).toString("hex"),
  };
}

export function applyMasterSessionConfig(session: MasterSessionConfig): void {
  process.env.ADMIN_TOKEN = session.adminToken;
  process.env.INSTANCE_ID = session.instanceId;
}

export function runtimeConfigSnapshot(
  config: ServerConfig,
  role: RuntimeRole,
  workerId?: number,
): RuntimeConfigSnapshot {
  const workerBasePort = resolvedWorkerBasePort();
  const numWorkers = config.numWorkers();
  const snapshot: RuntimeConfigSnapshot = {
    role,
    pid: process.pid,
    gameEnv: gameEnvName(config.env()),
    numWorkers,
    masterPort: resolvedMasterPort(),
    workerBasePort,
    workerPortRange: {
      start: workerBasePort,
      end: workerBasePort + Math.max(numWorkers - 1, 0),
    },
    domain: config.domain(),
    subdomain: config.subdomain(),
    jwtIssuer: config.jwtIssuer(),
  };

  if (role === "worker") {
    const resolvedWorker = workerId ?? resolvedWorkerId();
    snapshot.workerId = resolvedWorker;
    snapshot.workerPort = config.workerPortByIndex(resolvedWorker);
  }

  const instanceId = resolvedInstanceId();
  if (instanceId) {
    snapshot.instanceId = instanceId;
  }

  const controlPlaneUrl = resolvedControlPlaneUrl();
  if (controlPlaneUrl) {
    snapshot.controlPlaneUrl = controlPlaneUrl;
  }

  return snapshot;
}

export function templateRenderContext(): {
  gitCommit: string;
  instanceId: string;
} {
  return {
    gitCommit: normalizeString(Env.GIT_COMMIT) ?? "undefined",
    instanceId: resolvedInstanceId() ?? "undefined",
  };
}

export function otelPromLabels(config: ServerConfig): Record<string, string | undefined> {
  const component = Env.WORKER_ID ? `Worker ${resolvedWorkerId()}` : "Master";
  const domain = normalizeString((config as Partial<ServerConfig>).domain?.());
  const subdomain = normalizeString(
    (config as Partial<ServerConfig>).subdomain?.(),
  );

  return {
    "service.instance.id": normalizeString(Env.HOSTNAME),
    "openfront.environment": gameEnvName(config.env()),
    "openfront.host": normalizeString(Env.HOST),
    "openfront.domain": domain ?? normalizeString(Env.DOMAIN),
    "openfront.subdomain": subdomain ?? normalizeString(Env.SUBDOMAIN),
    "openfront.component": component,
  };
}
