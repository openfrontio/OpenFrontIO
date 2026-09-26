import type { Faro, TransportItem } from "@grafana/faro-web-sdk";
import { GameEnv } from "../core/configuration/Config";
import { ClientEnv } from "./ClientEnv";
import { clientPlatform } from "./ClientPlatform";

/**
 * Browser telemetry via Grafana Faro: uncaught errors, unhandled rejections,
 * console warnings and errors, web vitals, in-game performance summaries
 * (GameMetrics.ts) and session/view metadata, shipped to the collector named by
 * BOOTSTRAP_CONFIG.faroCollectorUrl (FARO_COLLECTOR_URL on the server).
 *
 * Off entirely when no URL is injected — dev, desktop shells without one,
 * any deployment that has not opted in. The SDK is loaded lazily so a page
 * without telemetry never downloads it and boot is never blocked on it.
 *
 * Console capture covers warn and error only; log and info are chatter.
 * console.error goes out as a log line, not an exception, so exceptions stay
 * the uncaught errors and the game errors reportGameError sends from the
 * error modal.
 */

// Fraction of sessions that send everything: measurements, events, console
// logs. Exceptions are sent by every session regardless (see filterSignal).
// Prod has enough players that 1% is plenty of signal; everywhere else every
// session reports, so a staging or dev deployment shows everything at once.
export function sessionSamplingRate(env: GameEnv): number {
  return env === GameEnv.Prod ? 0.01 : 1;
}

/**
 * Whether a session falls inside the sampled fraction. A hash of the session
 * id, so the answer is stable for the session, and persistent sessions keep
 * it across the reloads the client performs itself.
 */
export function isSessionSampled(sessionId: string, rate: number): boolean {
  if (rate >= 1) return true;
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < sessionId.length; i++) {
    hash ^= sessionId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000 < rate;
}

let faroPromise: Promise<Faro | null> | null = null;

export function initTelemetry(): Promise<Faro | null> {
  if (faroPromise !== null) return faroPromise;
  // Telemetry must never take the page down: a shell with no
  // BOOTSTRAP_CONFIG at all (a bare test DOM, say) just runs without it.
  let url: string | undefined;
  try {
    url = ClientEnv.faroCollectorUrl();
  } catch {
    url = undefined;
  }
  if (url === undefined) {
    faroPromise = Promise.resolve(null);
    return faroPromise;
  }
  const env = ClientEnv.env();
  faroPromise = import("@grafana/faro-web-sdk")
    .then(({ initializeFaro, getWebInstrumentations, LogLevel }) =>
      initializeFaro({
        url,
        app: {
          name: "openfront-client",
          version: ClientEnv.gitCommit(),
          environment: environmentName(env),
        },
        sessionTracking: {
          // Faro can only sample whole sessions, which would drop the
          // exceptions of every unsampled session too. Every session is
          // tracked here and filterSignal does the sampling instead.
          samplingRate: 1,
          // localStorage-backed, so a session (and its sampling decision)
          // survives the reloads the client performs itself — the apex
          // redirect, the versioned-path join, a rejoin after a crash.
          persistent: true,
          session: { attributes: { platform: clientPlatform() } },
        },
        // Resource timings are one event per fetch/XHR — every CDN asset,
        // API call and ad beacon, all match long — and were >90% of the
        // volume of a staging session at ~2KB a line. Navigation timing and
        // web vitals cover page load; the rest is not worth the ingest.
        trackResources: false,
        instrumentations: getWebInstrumentations({ captureConsole: true }),
        consoleInstrumentation: {
          disabledLevels: [
            LogLevel.TRACE,
            LogLevel.DEBUG,
            LogLevel.LOG,
            LogLevel.INFO,
          ],
          consoleErrorAsLog: true,
        },
        beforeSend: (item) => filterSignal(item, sessionSamplingRate(env)),
      }),
    )
    .catch((e: unknown) => {
      console.warn("Telemetry init failed", e);
      return null;
    });
  return faroPromise;
}

// Cloudflare's script monitor puts a report-only CSP (`connect-src 'none'`,
// disposition=report) on every page, and the browser then raises a
// securitypolicyviolation event for every fetch that policy would have
// blocked: each CDN asset, API call, and the Faro collector itself. Faro's
// default instrumentation forwards them all, which made them ~85% of prod
// event volume, none of it actionable since nothing is actually blocked.
const DROPPED_EVENTS = new Set(["securitypolicyviolation"]);

// Faro runs this hook unguarded on its flush path. Anything it cannot handle
// is dropped (null) rather than thrown or sent as-is: telemetry must neither
// reach the player nor leak what it was meant to cut.
function filterSignal(
  item: TransportItem,
  samplingRate: number,
): TransportItem | null {
  try {
    if (item.type === "event") {
      const name = (item.payload as { name?: unknown } | null)?.name;
      if (typeof name === "string" && DROPPED_EVENTS.has(name)) return null;
    }
    // Exceptions are the signal we most want and a sliver of the volume
    // (~0.4% of prod bytes), so only the rest is sampled.
    if (item.type !== "exception") {
      const sessionId = item.meta.session?.id;
      if (sessionId === undefined) return null;
      if (!isSessionSampled(sessionId, samplingRate)) return null;
    }
    return slimBrowserMeta(scrubUrls(item));
  } catch {
    return null;
  }
}

/**
 * Faro stamps the browser meta onto every signal, and the full user agent
 * plus the client-hint brand list were ~300 of a ~1.1KB line. Name, version,
 * OS and mobile, which stay, carry what they say.
 */
function slimBrowserMeta(item: TransportItem): TransportItem {
  const browser = item.meta.browser;
  if (browser === undefined) return item;
  const slim = { ...browser };
  delete slim.userAgent;
  delete slim.brands;
  item.meta = { ...item.meta, browser: slim };
  return item;
}

/**
 * Faro stamps location.href onto every signal (page meta) and the navigation
 * event carries the from/to URLs. The auth flows land single-use credentials
 * in the URL hash — `#steam-link?token=…`, `#token-login?token-login=…` — and
 * handleUrl() only strips them after userAuth() resolves, well after the SDK
 * has initialized. So every URL that leaves the page is cut to origin +
 * path: no query, no hash.
 */
export function stripUrl(url: string): string {
  return url.split(/[?#]/, 1)[0];
}

function scrubUrls(item: TransportItem): TransportItem {
  const page = item.meta.page;
  if (page?.url !== undefined) {
    item.meta = { ...item.meta, page: { ...page, url: stripUrl(page.url) } };
  }
  const attributes = (
    item.payload as { attributes?: Record<string, unknown> } | null
  )?.attributes;
  if (attributes !== undefined && attributes !== null) {
    for (const key of ["fromUrl", "toUrl"]) {
      const value = attributes[key];
      if (typeof value === "string") attributes[key] = stripUrl(value);
    }
  }
  return item;
}

/** Test-only. */
export function resetTelemetry(): void {
  faroPromise = null;
}

/**
 * A game-ending error the client showed the player: a sim crash, a worker
 * failure, a desync. `type` is the error-modal heading key, so the same
 * class of crash groups together in Grafana.
 */
export function reportGameError(
  error: string,
  message: string | undefined,
  gameID: string,
  clientID: string | undefined,
  type: string,
): void {
  void initTelemetry().then((faro) => {
    if (faro === null) return;
    faro.api.pushError(new Error(error), {
      type,
      context: {
        gameID,
        clientID: clientID ?? "",
        message: message ?? "",
      },
    });
  });
}

/**
 * A summarised in-game measurement (see GameMetrics.ts): one Faro
 * measurement of the given type, with the game and client it came from as
 * its context.
 */
export function reportMeasurement(
  type: string,
  values: Record<string, number>,
  context: Record<string, string>,
): void {
  void initTelemetry().then((faro) => {
    if (faro === null) return;
    faro.api.pushMeasurement({ type, values }, { context });
  });
}

function environmentName(env: GameEnv): string {
  switch (env) {
    case GameEnv.Prod:
      return "prod";
    // Matches ServerEnv.gameEnvName, so browser and server signals for one
    // deployment share an environment label in Grafana.
    case GameEnv.Preprod:
      return "staging";
    default:
      return "dev";
  }
}
