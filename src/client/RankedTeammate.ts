// The chosen ranked 2v2 teammate, by public id. Persisted rather than passed
// around because the requeue path (win modal -> /?requeue=2v2) RELOADS the page,
// so no in-memory value or event payload survives it. Storage is therefore the
// single source of truth: the ranked screen writes it, the matchmaking modal
// reads it when it queues, and every entry path (ranked screen, requeue URL,
// in-place requeue) behaves the same.
const TEAMMATE_KEY = "ranked-2v2-teammate";

export function getRankedTeammate(): string | null {
  try {
    // A stored empty string means "no teammate" — normalise it to null so
    // callers only ever test for null.
    const value = localStorage.getItem(TEAMMATE_KEY);
    return value === null || value === "" ? null : value;
  } catch {
    return null; // storage disabled (private mode)
  }
}

export function setRankedTeammate(publicId: string): void {
  try {
    if (publicId) {
      localStorage.setItem(TEAMMATE_KEY, publicId);
    } else {
      localStorage.removeItem(TEAMMATE_KEY);
    }
  } catch {
    /* best-effort; the field still works for this session */
  }
}
