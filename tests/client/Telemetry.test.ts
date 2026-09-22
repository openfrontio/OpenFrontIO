import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import {
  initTelemetry,
  reportGameError,
  resetTelemetry,
} from "../../src/client/Telemetry";

const pushError = vi.fn();
const initializeFaro = vi.fn((_config: unknown) => ({ api: { pushError } }));
const getWebInstrumentations = vi.fn((_options: unknown) => []);

vi.mock("@grafana/faro-web-sdk", () => ({
  initializeFaro: (config: unknown) => initializeFaro(config),
  getWebInstrumentations: (options: unknown) => getWebInstrumentations(options),
}));

function page(extra: Record<string, unknown> = {}) {
  ClientEnv.reset();
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    turnstileSiteKey: "site-key",
    jwtAudience: "openfront.io",
    gitCommit: "abc1234",
    ...extra,
  };
}

describe("Telemetry", () => {
  beforeEach(() => {
    resetTelemetry();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (window as any).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
  });

  it("stays off, and never loads the SDK, without a collector URL", async () => {
    page();
    expect(await initTelemetry()).toBeNull();
    expect(initializeFaro).not.toHaveBeenCalled();

    reportGameError("boom", undefined, "gameid", "client", "crashed");
    await Promise.resolve();
    expect(pushError).not.toHaveBeenCalled();
  });

  it("initializes once against the injected collector, tagged with the build", async () => {
    page({ faroCollectorUrl: "https://faro.example/collect/k" });

    const first = await initTelemetry();
    const second = await initTelemetry();

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(initializeFaro).toHaveBeenCalledTimes(1);
    expect(initializeFaro.mock.calls[0][0]).toMatchObject({
      url: "https://faro.example/collect/k",
      app: {
        name: "openfront-client",
        version: "abc1234",
        environment: "prod",
      },
      sessionTracking: { session: { attributes: { platform: "web" } } },
    });
    expect(getWebInstrumentations).toHaveBeenCalledWith({
      captureConsole: false,
    });
  });

  it("reports a game error with its game and client ids", async () => {
    page({ faroCollectorUrl: "https://faro.example/collect/k" });

    reportGameError(
      "boom",
      "details",
      "gameid",
      "client",
      "error_modal.desync_notice",
    );
    await initTelemetry();
    await Promise.resolve();

    expect(pushError).toHaveBeenCalledTimes(1);
    const [err, opts] = pushError.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("boom");
    expect(opts).toEqual({
      type: "error_modal.desync_notice",
      context: { gameID: "gameid", clientID: "client", message: "details" },
    });
  });
});
