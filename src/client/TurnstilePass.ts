/**
 * Client-side hint recording whether a persistent ID has recently cleared a
 * server-verified Turnstile challenge, so subsequent joins within the pass TTL
 * can skip prefetching/submitting a fresh Turnstile token unless challenged.
 */

/**
 * Duration (6 hours) a recorded Turnstile pass hint remains valid.
 */
export const TURNSTILE_PASS_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Returns the localStorage key used to store the Turnstile pass timestamp for
 * the given persistent ID.
 */
export function turnstilePassKey(persistentId: string): string {
  return `turnstilePass:${persistentId}`;
}

/**
 * Reads the stored Turnstile pass timestamp for `persistentId`, or `null` if
 * missing, malformed, or `localStorage` throws.
 */
export function readTurnstilePassTimestamp(
  persistentId: string,
): number | null {
  if (!persistentId) return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(turnstilePassKey(persistentId));
  } catch {
    return null;
  }
  if (raw === null || raw.trim() === "") return null;
  const ts = Number(raw);
  return Number.isFinite(ts) && ts >= 0 ? ts : null;
}

/**
 * Returns true when `persistentId` has a stored Turnstile pass timestamp that
 * is non-negative, not in the future relative to `now`, and strictly younger
 * than `TURNSTILE_PASS_TTL_MS`. Returns false on missing/invalid data or if
 * `localStorage` throws.
 */
export function hasValidTurnstilePass(
  persistentId: string,
  now = Date.now(),
): boolean {
  const ts = readTurnstilePassTimestamp(persistentId);
  return ts !== null && ts <= now && now - ts < TURNSTILE_PASS_TTL_MS;
}

/**
 * Records a Turnstile pass timestamp (`now`) for `persistentId` in
 * `localStorage`. No-ops on empty `persistentId` or storage errors.
 */
export function recordTurnstilePass(
  persistentId: string,
  now = Date.now(),
): void {
  if (!persistentId) return;
  try {
    localStorage.setItem(turnstilePassKey(persistentId), String(now));
  } catch {
    // Restricted or full localStorage must never block the join flow.
  }
}

/**
 * Clears any stored Turnstile pass hint for `persistentId`. When
 * `maxTimestamp` is provided, preserves any newer hint (`stored > maxTimestamp`)
 * recorded by another tab after this attempt started. No-ops on empty
 * `persistentId` or storage errors.
 */
export function clearTurnstilePass(
  persistentId: string,
  maxTimestamp?: number,
): void {
  if (!persistentId) return;
  try {
    if (maxTimestamp !== undefined) {
      const current = readTurnstilePassTimestamp(persistentId);
      if (current !== null && current > maxTimestamp) {
        return;
      }
    }
    localStorage.removeItem(turnstilePassKey(persistentId));
  } catch {
    // Restricted localStorage must never block the join flow.
  }
}
