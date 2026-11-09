import { whenPageIdle } from "./WhenPageIdle";

/**
 * The game client (the lobby connection, the HUD, the renderer) is its own
 * chunk, so the homepage loads without it. prefetchGameClient fetches it in
 * the background once the page has loaded, so a join rarely waits on it.
 */
export function loadGameClient(): Promise<typeof import("./ClientGameRunner")> {
  return import("./ClientGameRunner");
}

export function prefetchGameClient(): void {
  // A failed prefetch is left to the join that needs the chunk.
  whenPageIdle(() => void loadGameClient().catch(() => {}));
}

const RELOAD_KEY = "gameClientReloadAt";
const RELOAD_WINDOW_MS = 5 * 60 * 1000;

/**
 * Whether a failed load of the game chunk may reload the page. A reload picks
 * up a newer deploy, but when the chunk is missing for good (the desktop
 * shell's copy is damaged, or the CDN keeps failing) every reload fails the
 * same way, so allow one per window and let the caller say so instead.
 * Unreadable storage counts as already reloaded: a message beats a loop.
 */
export function claimGameClientReload(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY));
    if (last > 0 && now - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
