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
      sessionTracking: {
        samplingRate: 0.01,
        persistent: true,
        session: { attributes: { platform: "web" } },
      },
    });
    expect(getWebInstrumentations).toHaveBeenCalledWith({
      captureConsole: false,
    });
  });

  // Prod has the players to make 1% plenty; a staging deployment wants every
  // session so its errors show up at once.
  it("samples 1% of sessions in prod and every session on staging", async () => {
    page({
      gameEnv: "staging",
      faroCollectorUrl: "https://faro.example/collect/k",
    });
    await initTelemetry();
    expect(initializeFaro.mock.calls[0][0]).toMatchObject({
      app: { environment: "staging" },
      sessionTracking: { samplingRate: 1 },
    });
  });

  // The auth flows park single-use tokens in the URL hash until handleUrl()
  // strips them, and Faro stamps location.href onto every signal. Nothing
  // past the path may leave the page.
  it("cuts every outgoing URL to origin + path", async () => {
    page({ faroCollectorUrl: "https://faro.example/collect/k" });
    await initTelemetry();

    const config = initializeFaro.mock.calls[0][0] as {
      beforeSend: (item: unknown) => unknown;
    };
    const item = {
      type: "event",
      payload: {
        name: "navigation",
        attributes: {
          fromUrl: "https://openfront.io/#steam-link?token=secret",
          toUrl: "https://openfront.io/game/abc?x=1#y",
          other: "kept",
        },
      },
      meta: {
        page: { url: "https://openfront.io/#token-login?token-login=secret" },
        app: { name: "openfront-client" },
      },
    };

    expect(config.beforeSend(item)).toEqual({
      type: "event",
      payload: {
        name: "navigation",
        attributes: {
          fromUrl: "https://openfront.io/",
          toUrl: "https://openfront.io/game/abc",
          other: "kept",
        },
      },
      meta: {
        page: { url: "https://openfront.io/" },
        app: { name: "openfront-client" },
      },
    });
  });

  it("passes a signal without a page or attributes through untouched", async () => {
    page({ faroCollectorUrl: "https://faro.example/collect/k" });
    await initTelemetry();
    const config = initializeFaro.mock.calls[0][0] as {
      beforeSend: (item: unknown) => unknown;
    };
    const item = { type: "log", payload: { message: "m" }, meta: {} };
    expect(config.beforeSend(item)).toEqual(item);
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
