import { afterEach, describe, expect, it } from "vitest";
import { GameEnv } from "../../src/core/configuration/Config";
import {
  gameEnvName,
  otelPromLabels,
  resolvedMasterPort,
  resolvedControlPlaneUrl,
  resolvedWorkerBasePort,
  resolvedWorkerId,
  runtimeConfigSnapshot,
} from "../../src/server/RuntimeConfig";

const originalEnv = {
  MASTER_PORT: process.env.MASTER_PORT,
  WORKER_BASE_PORT: process.env.WORKER_BASE_PORT,
  WORKER_ID: process.env.WORKER_ID,
  HOST: process.env.HOST,
  HOSTNAME: process.env.HOSTNAME,
  CONTROL_PLANE_URL: process.env.CONTROL_PLANE_URL,
};

afterEach(() => {
  process.env.MASTER_PORT = originalEnv.MASTER_PORT;
  process.env.WORKER_BASE_PORT = originalEnv.WORKER_BASE_PORT;
  process.env.WORKER_ID = originalEnv.WORKER_ID;
  process.env.HOST = originalEnv.HOST;
  process.env.HOSTNAME = originalEnv.HOSTNAME;
  process.env.CONTROL_PLANE_URL = originalEnv.CONTROL_PLANE_URL;
});

const config = {
  numWorkers: () => 3,
  env: () => GameEnv.Preprod,
  domain: () => "openfront.dev",
  subdomain: () => "play",
  jwtIssuer: () => "https://api.openfront.dev",
  workerPortByIndex: (workerIndex: number) => 4500 + workerIndex,
} as any;

describe("RuntimeConfig", () => {
  it("uses defaults when ports and worker id are invalid", () => {
    process.env.MASTER_PORT = "invalid";
    process.env.WORKER_BASE_PORT = "-1";
    process.env.WORKER_ID = "x";

    expect(resolvedMasterPort()).toBe(3000);
    expect(resolvedWorkerBasePort()).toBe(3001);
    expect(resolvedWorkerId()).toBe(0);
  });

  it("builds a master runtime snapshot with derived worker port range", () => {
    process.env.MASTER_PORT = "4100";
    process.env.WORKER_BASE_PORT = "4200";

    const snapshot = runtimeConfigSnapshot(config, "master");
    expect(snapshot.masterPort).toBe(4100);
    expect(snapshot.workerPortRange).toEqual({ start: 4200, end: 4202 });
    expect(snapshot.role).toBe("master");
    expect(snapshot.gameEnv).toBe("staging");
  });

  it("builds a worker runtime snapshot and labels", () => {
    process.env.WORKER_ID = "2";
    process.env.HOST = "0.0.0.0";
    process.env.HOSTNAME = "pod-abc";

    const snapshot = runtimeConfigSnapshot(config, "worker", 2);
    expect(snapshot.workerId).toBe(2);
    expect(snapshot.workerPort).toBe(4502);

    const labels = otelPromLabels(config);
    expect(labels["service.instance.id"]).toBe("pod-abc");
    expect(labels["openfront.host"]).toBe("0.0.0.0");
    expect(labels["openfront.component"]).toBe("Worker 2");
  });

  it("maps game environments to deployment names", () => {
    expect(gameEnvName(GameEnv.Dev)).toBe("dev");
    expect(gameEnvName(GameEnv.Preprod)).toBe("staging");
    expect(gameEnvName(GameEnv.Prod)).toBe("prod");
  });

  it("exposes optional control plane url when configured", () => {
    process.env.CONTROL_PLANE_URL = "http://127.0.0.1:3100";
    expect(resolvedControlPlaneUrl()).toBe("http://127.0.0.1:3100");

    const snapshot = runtimeConfigSnapshot(config, "master");
    expect(snapshot.controlPlaneUrl).toBe("http://127.0.0.1:3100");
  });
});
