export interface AdmiralMeasureResult {
  /** True when the visitor has an adblocker active. */
  adblocking?: boolean;
  /**
   * Admiral's OWN ad-free pass (its paywall), NOT our tier. Intentionally
   * ignored: OpenFront ad-free is the server `adfree` flag (any shop purchase →
   * ad-free for life), which already zeroes `window.adsEnabled` so Admiral
   * never loads for those users. Only wire this if we ever sell via Admiral.
   */
  subscribed?: boolean;
  /** True when the visitor has whitelisted this site in their blocker (ads render). */
  whitelisted?: boolean;
}

type AdmiralFn = {
  (
    hook: "after",
    event: "measure.detected",
    cb: (res: AdmiralMeasureResult) => void,
  ): void;
  q?: unknown[];
  v?: number;
  s?: string;
};

interface GoogleTag {
  cmd: Array<() => void>;
  pubads?: () => { setTargeting: (key: string, value: string) => void };
}

declare global {
  interface Window {
    admiral?: AdmiralFn;
    googletag?: GoogleTag;
  }
}

/**
 * Admiral ad-recovery payload. The delivery domain is intentionally disguised
 * and ROTATES — when the provider reissues the tag, re-sync this from it.
 * This third-party script runs with full page access, so it is injected ONLY
 * for ad-eligible (non-adfree) users and NEVER for paid sessions.
 */
const ADMIRAL_PAYLOAD_SRC =
  "https://introjava.com/assets/js/gfjjtpm64er_5.v1.js";

/**
 * localStorage key Admiral writes its GAM targeting segments (`.lgk`) to.
 * Encodes the Admiral property id; re-sync alongside ADMIRAL_PAYLOAD_SRC.
 */
const ADMIRAL_GAM_KEY = "_aQS02Mzg3RDEwMjU5NjBGOUQ0REY5Q0YwOTEtNjc0";

let injected = false;

/**
 * Injects the Admiral tag. Call for FREE (ad-eligible) users ONLY — gating
 * happens at the single call site so paid users never load Admiral at all
 * (its adblock popup fires autonomously once the payload runs).
 */
export function loadAdmiral(): void {
  if (injected) return;
  injected = true;

  // 1. Command-queue stub — must exist before the payload loads so buffered
  //    admiral(...) calls replay once it initializes (same pattern as gtag).
  if (!window.admiral) {
    const stub = function (...args: unknown[]): void {
      (stub.q = stub.q ?? []).push(args);
    } as AdmiralFn;
    stub.v = 2;
    stub.s = "1";
    window.admiral = stub;
  }

  // 2. Async-load the remote payload.
  const s = document.createElement("script");
  s.async = true;
  s.src = ADMIRAL_PAYLOAD_SRC;
  document.head.appendChild(s);

  // 3. GAM key-value shim: replay Admiral's stored targeting segments into
  //    Google Ad Manager. Self-guarded; harmlessly no-ops if GAM isn't used
  //    to serve (this app serves via Playwire RAMP).
  applyGamTargeting();
}

function applyGamTargeting(): void {
  const push = (): void => {
    try {
      const raw = window.localStorage.getItem(ADMIRAL_GAM_KEY);
      if (raw === null) return;
      const lgk: Array<[string, string?]> = JSON.parse(raw).lgk ?? [];
      const pubads = window.googletag?.pubads?.();
      if (!pubads) return;
      for (const entry of lgk) {
        if (entry?.[0]) pubads.setTargeting(entry[0], entry[1] ?? "");
      }
    } catch {
      /* targeting is best-effort */
    }
  };
  try {
    const gt = (window.googletag = window.googletag ?? { cmd: [] });
    gt.cmd = gt.cmd ?? [];
    if (typeof gt.pubads === "function") push();
    else gt.cmd.unshift(push);
  } catch {
    /* targeting is best-effort */
  }
}

/**
 * Registers Admiral's measurement callback. Safe to call before the payload
 * loads (buffered in the command queue). Fires only if Admiral's payload
 * actually loads — a blocker that kills the delivery domain also kills this,
 * which is why AdGatekeeper's bait detector remains the source of truth.
 */
export function onAdmiralMeasured(
  cb: (res: AdmiralMeasureResult) => void,
): void {
  window.admiral?.("after", "measure.detected", cb);
}
