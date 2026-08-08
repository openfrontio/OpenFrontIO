// The chosen ranked 2v2 teammate, by public id. Persisted because the requeue
// path (/?requeue=2v2) reloads the page, so nothing in memory survives it. One
// source of truth keeps every queue entry path in agreement.
const TEAMMATE_KEY = "ranked-2v2-teammate";

// Mirror, so the feature still works for this page when storage is unavailable
// (private mode) instead of silently queueing solo.
let inMemory: string | null = null;

/**
 * The stored teammate, or null when unset. Pass the signed-in player's own id to
 * reject (and clear) a self-reference: two accounts in one browser can leave the
 * other's id behind, and queueing with your own means waiting on yourself.
 */
export function getRankedTeammate(ownPublicId?: string | null): string | null {
  let value: string | null = inMemory;
  try {
    value = localStorage.getItem(TEAMMATE_KEY) ?? inMemory;
  } catch {
    /* storage disabled; the in-memory mirror stands in */
  }
  // Empty means "no teammate"; normalise so callers only test for null.
  if (value === null || value === "") return null;
  if (
    ownPublicId !== undefined &&
    ownPublicId !== null &&
    value === ownPublicId
  ) {
    setRankedTeammate("");
    return null;
  }
  return value;
}

export function setRankedTeammate(publicId: string): void {
  inMemory = publicId === "" ? null : publicId;
  try {
    if (publicId) {
      localStorage.setItem(TEAMMATE_KEY, publicId);
    } else {
      localStorage.removeItem(TEAMMATE_KEY);
    }
  } catch {
    /* best-effort; the in-memory mirror keeps it for this page */
  }
}
