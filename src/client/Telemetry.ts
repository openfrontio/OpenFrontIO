import type { Faro, TransportItem } from "@grafana/faro-web-sdk";
import { GameEnv } from "../core/configuration/Config";
import { ClientEnv } from "./ClientEnv";
import { clientPlatform } from "./ClientPlatform";

/**
 * Browser telemetry via Grafana Faro: uncaught errors, unhandled rejections,
 * web vitals and session/view metadata, shipped to the collector named by
 * BOOTSTRAP_CONFIG.faroCollectorUrl (FARO_COLLECTOR_URL on the server).
 *
 * Off entirely when no URL is injected — dev, desktop shells without one,
 * any deployment that has not opted in. The SDK is loaded lazily so a page
 * without telemetry never downloads it and boot is never blocked on it.
 *
 * Console capture is deliberately off: the client logs freely through
 * console.error, and forwarding all of it would drown the signal. Game
 * crashes go through reportGameError instead, which is what the error modal
 * calls.
 */

// Fraction of sessions that report at all. Faro samples per session, so an
// unsampled session sends nothing — errors included.
const SESSION_SAMPLING_RATE = 1;

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
  faroPromise = import("@grafana/faro-web-sdk")
    .then(({ initializeFaro, getWebInstrumentations }) =>
      initializeFaro({
        url,
        app: {
          name: "openfront-client",
          version: ClientEnv.gitCommit(),
          environment: environmentName(ClientEnv.env()),
        },
        sessionTracking: {
          samplingRate: SESSION_SAMPLING_RATE,
          session: { attributes: { platform: clientPlatform() } },
        },
        instrumentations: getWebInstrumentations({ captureConsole: false }),
        beforeSend: scrubUrls,
      }),
    )
    .catch((e: unknown) => {
      console.warn("Telemetry init failed", e);
      return null;
    });
  return faroPromise;
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
  const attributes = (item.payload as { attributes?: Record<string, unknown> })
    .attributes;
  if (attributes !== undefined) {
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

function environmentName(env: GameEnv): string {
  switch (env) {
    case GameEnv.Prod:
      return "prod";
    case GameEnv.Preprod:
      return "preprod";
    default:
      return "dev";
  }
}
