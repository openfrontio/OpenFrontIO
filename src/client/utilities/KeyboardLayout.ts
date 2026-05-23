/**
 * Wrapper around the [Keyboard Layout Map API][1] for resolving
 * physical key codes (e.g. `"KeyW"`) to the character produced by
 * the user's actual keyboard layout (e.g. `"z"` on a French AZERTY
 * keyboard, `","` on a Dvorak keyboard, `"ц"` on Russian, etc.).
 *
 * Available in Chromium-based browsers (Chrome, Edge, Opera, Brave,
 * Samsung Internet). Firefox and Safari do not implement this API
 * at the time of writing — `getKeyForCode()` returns `null` there
 * and callers should fall back to a sensible default (typically
 * the QWERTY letter encoded in the `code` itself).
 *
 * The layout map is loaded lazily and cached. When the user
 * switches keyboard layouts at the OS level, the browser may fire
 * a `layoutchange` event on `navigator.keyboard`; the cache is
 * invalidated and registered subscribers are notified so they can
 * re-render. Browsers that have removed the `layoutchange` event
 * still work, they just need a page reload to pick up new layouts.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Keyboard
 *
 * @see https://github.com/openfrontio/OpenFrontIO/issues/1071
 */

interface KeyboardApi extends EventTarget {
  getLayoutMap(): Promise<Map<string, string>>;
}

let cachedLayout: ReadonlyMap<string, string> | null = null;
let pendingLoad: Promise<void> | null = null;
let layoutChangeBound = false;
// Monotonic counter incremented on every `layoutchange` so an older,
// still-in-flight `performLoad` that resolves *after* a newer load has
// started cannot overwrite `cachedLayout` with stale data.
let loadGeneration = 0;
const subscribers = new Set<() => void>();

function getKeyboardApi(): KeyboardApi | null {
  if (typeof navigator === "undefined") return null;
  const k = (navigator as unknown as { keyboard?: KeyboardApi }).keyboard;
  if (!k || typeof k.getLayoutMap !== "function") return null;
  return k;
}

function notifySubscribers(): void {
  // Iterate over a snapshot so a subscriber that unsubscribes during
  // notification doesn't skip its successors.
  for (const cb of [...subscribers]) {
    try {
      cb();
    } catch (e) {
      console.error("KeyboardLayout subscriber threw:", e);
    }
  }
}

function bindLayoutChange(api: KeyboardApi): void {
  if (layoutChangeBound) return;
  try {
    api.addEventListener("layoutchange", onLayoutChange);
    layoutChangeBound = true;
  } catch {
    // Some browsers expose getLayoutMap but not the event - that's
    // fine, the cache just won't auto-invalidate.
  }
}

function onLayoutChange(): void {
  // Bump the generation *before* clearing state so any in-flight
  // `performLoad` that resolves after this point sees a mismatched
  // generation and skips its commit.
  loadGeneration += 1;
  cachedLayout = null;
  pendingLoad = null;
  // Notify subscribers immediately so components fall back to the QWERTY
  // path while the new layout is being fetched, then kick off a fresh load
  // — `loadKeyboardLayout` will notify subscribers again from its `.finally`
  // hook so labels update once the new map resolves.
  notifySubscribers();
  void loadKeyboardLayout();
}

async function performLoad(): Promise<void> {
  // Capture the generation at the start of this load. If `onLayoutChange`
  // bumps the counter while we await `getLayoutMap`, the generation we
  // captured will no longer match and we must drop our result rather
  // than overwrite a fresher load's cache.
  const startGeneration = loadGeneration;
  const api = getKeyboardApi();
  if (!api) return;
  bindLayoutChange(api);
  try {
    const map = await api.getLayoutMap();
    if (startGeneration !== loadGeneration) return;
    cachedLayout = map;
  } catch (e) {
    if (startGeneration !== loadGeneration) return;
    console.warn("Failed to load keyboard layout map:", e);
    cachedLayout = null;
  }
}

/**
 * Loads the keyboard layout map. Idempotent — concurrent calls
 * share the same in-flight Promise, and subsequent calls after a
 * successful load resolve immediately.
 *
 * Awaiting this is optional. Callers that can render synchronously
 * with a fallback (e.g. {@link getKeyForCode} returning `null` →
 * fall back to the QWERTY character) need only call this once at
 * bootstrap and let the eventual update flow through subscribers.
 */
export function loadKeyboardLayout(): Promise<void> {
  if (cachedLayout !== null) return Promise.resolve();
  pendingLoad ??= performLoad().finally(() => {
    // Notify even on failure — subscribers should re-render with the
    // fallback path rather than waiting forever.
    notifySubscribers();
  });
  return pendingLoad;
}

/**
 * Returns the character produced by the user's keyboard for the
 * given physical key code, or `null` if:
 *   - the browser does not implement the Keyboard Layout Map API,
 *   - {@link loadKeyboardLayout} has not yet resolved, or
 *   - the layout map has no entry for this code (rare — usually
 *     means the code refers to a non-printable key).
 *
 * Callers should treat `null` as "fall back to the QWERTY default
 * encoded in the code".
 *
 * Synchronous; does **not** trigger a load. Pair with
 * {@link subscribeToLayoutChange} to re-render when the load
 * resolves.
 *
 * @param code - A `KeyboardEvent.code` value such as `"KeyW"`,
 *   `"Digit1"`, `"Period"`, `"Slash"`.
 */
export function getKeyForCode(code: string): string | null {
  if (!cachedLayout) return null;
  const ch = cachedLayout.get(code);
  return typeof ch === "string" && ch.length > 0 ? ch : null;
}

/**
 * Subscribe to layout-availability changes. The callback fires:
 *   1. Once after {@link loadKeyboardLayout} resolves (success
 *      _or_ failure — the cache state is now final).
 *   2. Each time the OS emits a `layoutchange` event on the
 *      Keyboard API (where supported).
 *
 * The callback receives no arguments; query the new state via
 * {@link getKeyForCode}.
 *
 * @returns A disposer that removes the subscription.
 */
export function subscribeToLayoutChange(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * @internal Test-only: reset module-level state between test cases.
 * Not part of the public API.
 */
export function _resetForTesting(): void {
  const api = getKeyboardApi();
  if (api && layoutChangeBound) {
    try {
      api.removeEventListener("layoutchange", onLayoutChange);
    } catch {
      // best-effort
    }
  }
  cachedLayout = null;
  pendingLoad = null;
  layoutChangeBound = false;
  loadGeneration = 0;
  subscribers.clear();
}
