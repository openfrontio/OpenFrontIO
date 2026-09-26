import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import {
  initTelemetry,
  isSessionSampled,
  reportGameError,
  reportMeasurement,
  resetTelemetry,
} from "../../src/client/Telemetry";

const pushError = vi.fn();
const pushMeasurement = vi.fn();
const initializeFaro = vi.fn((_config: unknown) => ({
  api: { pushError, pushMeasurement },
}));
const getWebInstrumentations = vi.fn((_options: unknown) => []);

vi.mock("@grafana/faro-web-sdk", () => ({
  initializeFaro: (config: unknown) => initializeFaro(config),
  getWebInstrumentations: (options: unknown) => getWebInstrumentations(options),
  LogLevel: {
    TRACE: "trace",
    DEBUG: "debug",
    INFO: "info",
    LOG: "log",
    WARN: "warn",
    ERROR: "error",
  },
}));

type BeforeSend = (item: unknown) => unknown;

async function beforeSendFor(
  extra: Record<string, unknown> = {},
): Promise<BeforeSend> {
  page({ faroCollectorUrl: "https://faro.example/collect/k", ...extra });
  await initTelemetry();
  return (initializeFaro.mock.calls[0][0] as { beforeSend: BeforeSend })
    .beforeSend;
}

// Session ids on either side of the 1% prod cut.
function sessionIds(): { inside: string; outside: string } {
  let inside: string | undefined;
  let outside: string | undefined;
  for (let i = 0; inside === undefined || outside === undefined; i++) {
    const id = `session${i}`;
    if (isSessionSampled(id, 0.01)) inside ??= id;
    else outside ??= id;
  }
  return { inside, outside };
}

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
    reportMeasurement("frame_time", { p50: 16 }, { gameID: "gameid" });
    await Promise.resolve();
    expect(pushError).not.toHaveBeenCalled();
    expect(pushMeasurement).not.toHaveBeenCalled();
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
        samplingRate: 1,
        persistent: true,
        session: { attributes: { platform: "web" } },
      },
      trackResources: false,
    });
    expect(getWebInstrumentations).toHaveBeenCalledWith({
      captureConsole: true,
    });
    expect(initializeFaro.mock.calls[0][0]).toMatchObject({
      consoleInstrumentation: {
        disabledLevels: ["trace", "debug", "log", "info"],
        consoleErrorAsLog: true,
      },
    });
  });

  it("samples a session id the same way every time, at about the rate", () => {
    let sampled = 0;
    for (let i = 0; i < 10_000; i++) {
      const id = `s${i}`;
      expect(isSessionSampled(id, 0.01)).toBe(isSessionSampled(id, 0.01));
      if (isSessionSampled(id, 0.01)) sampled++;
    }
    expect(sampled).toBeGreaterThan(50);
    expect(sampled).toBeLessThan(150);
    expect(isSessionSampled("anything", 1)).toBe(true);
  });

  // Faro would drop an unsampled session's exceptions along with the rest,
  // so its own sampling is off and prod sessions outside the 1% still send
  // exceptions, and only exceptions.
  it("sends exceptions from every prod session and the rest from 1%", async () => {
    const beforeSend = await beforeSendFor();
    const { inside, outside } = sessionIds();
    const signal = (type: string, session: string) => ({
      type,
      payload: {},
      meta: { session: { id: session } },
    });

    for (const type of ["measurement", "log", "event"]) {
      expect(beforeSend(signal(type, inside))).not.toBeNull();
      expect(beforeSend(signal(type, outside))).toBeNull();
    }
    expect(beforeSend(signal("exception", outside))).not.toBeNull();
  });

  it("sends everything from every session on staging", async () => {
    const beforeSend = await beforeSendFor({ gameEnv: "staging" });
    expect(initializeFaro.mock.calls[0][0]).toMatchObject({
      app: { environment: "staging" },
    });
    const { outside } = sessionIds();
    const item = {
      type: "log",
      payload: {},
      meta: { session: { id: outside } },
    };
    expect(beforeSend(item)).toEqual(item);
  });

  it("drops the user agent and brand list from the browser meta", async () => {
    const beforeSend = await beforeSendFor();
    const item = {
      type: "exception",
      payload: {},
      meta: {
        browser: {
          name: "Chrome",
          version: "151",
          os: "Mac OS",
          mobile: false,
          userAgent: "Mozilla/5.0 ...",
          brands: [{ brand: "Chromium", version: "151" }],
        },
      },
    };
    expect(beforeSend(item)).toEqual({
      type: "exception",
      payload: {},
      meta: {
        browser: {
          name: "Chrome",
          version: "151",
          os: "Mac OS",
          mobile: false,
        },
      },
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
        session: { id: sessionIds().inside },
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
        session: { id: sessionIds().inside },
      },
    });
  });

  it("passes a signal without a page or attributes through untouched", async () => {
    page({ faroCollectorUrl: "https://faro.example/collect/k" });
    await initTelemetry();
    const config = initializeFaro.mock.calls[0][0] as {
      beforeSend: (item: unknown) => unknown;
    };
    const item = {
      type: "log",
      payload: { message: "m" },
      meta: { session: { id: sessionIds().inside } },
    };
    expect(config.beforeSend(item)).toEqual(item);
  });

  // Cloudflare's report-only CSP makes the browser fire one of these per
  // fetch; nothing is blocked, so they are volume without signal.
  it("drops CSP violation reports and keeps other browser events", async () => {
    page({ faroCollectorUrl: "https://faro.example/collect/k" });
    await initTelemetry();
    const config = initializeFaro.mock.calls[0][0] as {
      beforeSend: (item: unknown) => unknown;
    };
    const csp = {
      type: "event",
      payload: {
        name: "securitypolicyviolation",
        attributes: { blockedURI: "https://cdn.ofedge.io/x.mp3" },
      },
      meta: {
        page: { url: "https://openfront.io/" },
        session: { id: sessionIds().inside },
      },
    };
    expect(config.beforeSend(csp)).toBe(null);

    const start = {
      type: "event",
      payload: { name: "session_start", attributes: {} },
      meta: {
        page: { url: "https://openfront.io/" },
        session: { id: sessionIds().inside },
      },
    };
    expect(config.beforeSend(start)).toEqual(start);
  });

  // Faro does not guard the hook, so a shape it cannot scrub must be dropped,
  // never thrown (into Faro's flush timer) and never sent unscrubbed.
  it("drops a signal it cannot scrub instead of throwing", async () => {
    page({ faroCollectorUrl: "https://faro.example/collect/k" });
    await initTelemetry();
    const config = initializeFaro.mock.calls[0][0] as {
      beforeSend: (item: unknown) => unknown;
    };
    expect(
      config.beforeSend({ type: "event", payload: null, meta: null }),
    ).toBe(null);
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

  it("reports a measurement with its values and context", async () => {
    page({ faroCollectorUrl: "https://faro.example/collect/k" });

    reportMeasurement(
      "tick_interval",
      { p50: 100, p90: 120, p99: 400, count: 300 },
      { gameID: "gameid", clientID: "client" },
    );
    await initTelemetry();
    await Promise.resolve();

    expect(pushMeasurement).toHaveBeenCalledTimes(1);
    expect(pushMeasurement).toHaveBeenCalledWith(
      {
        type: "tick_interval",
        values: { p50: 100, p90: 120, p99: 400, count: 300 },
      },
      { context: { gameID: "gameid", clientID: "client" } },
    );
  });
});
