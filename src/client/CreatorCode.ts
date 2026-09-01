// A player can arrive at `openfront.io/c/<code>` while logged out. Binding
// the code to an account requires an authenticated `PUT /users/@me/creator`
// call (see Task 1's Api.ts), so an anonymous visit has to send the player
// through login first -- Discord/Google OAuth or a magic link, same as
// SteamLink.ts's account-linking gate. A magic link in particular only
// round-trips the site's origin, never the path it was clicked from, so the
// code cannot ride along in the URL: it has to be stashed in localStorage
// before redirecting, and read back once the player returns signed in.

const PENDING_CREATOR_CODE_KEY = "creator-code-pending";

// How long a stashed code stays worth resuming. There is no server-side
// ticket to expire against here (unlike Steam's link token) -- this is
// purely about how stale an abandoned sign-up attempt gets before resuming
// it would surprise the player more than help them. A week comfortably
// covers a slow sign-up (an email provider sitting on the magic link, a
// player closing the tab and coming back later) while still expiring an
// intent nobody is going to finish.
const PENDING_CREATOR_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The code has already been through normalizeCreatorCodeInput by the time it
// gets here (see the panel that calls this), so this only has to carry it
// across the redirect -- not validate it again.
export function stashPendingCreatorCode(code: string): void {
  localStorage.setItem(
    PENDING_CREATOR_CODE_KEY,
    JSON.stringify({ code, stashedAt: Date.now() }),
  );
}

// Consumed on read: once taken, a stale/already-handled entry can't re-fire
// on a later page load. Also expires on read: an entry older than
// PENDING_CREATOR_CODE_TTL_MS is discarded (still consumed, just returned as
// null) rather than resumed. Malformed/legacy storage degrades to null
// rather than throwing -- a leftover value from before this change (or a
// hand-edited localStorage entry) must not crash every subsequent page load
// for whoever still has one.
export function takePendingCreatorCode(): string | null {
  const raw = localStorage.getItem(PENDING_CREATOR_CODE_KEY);
  if (raw === null) return null;
  localStorage.removeItem(PENDING_CREATOR_CODE_KEY);

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const candidate = parsed as { code?: unknown; stashedAt?: unknown };

      // A missing or non-numeric stashedAt means a pre-TTL entry (or a
      // corrupted one). Its age cannot be established, so it is treated as
      // expired rather than resumed -- see PENDING_CREATOR_CODE_TTL_MS.
      if (
        typeof candidate.stashedAt !== "number" ||
        Date.now() - candidate.stashedAt > PENDING_CREATOR_CODE_TTL_MS
      ) {
        return null;
      }

      if (typeof candidate.code === "string") {
        return candidate.code;
      }
    }
  } catch {
    // Legacy raw-string format, or otherwise unparsable -- fall through to
    // null below rather than throwing.
  }
  return null;
}

// Client-side mirror of the server's normalizeCreatorCode (infra
// `src/api/lib/Creators.ts`): trim, uppercase, then restrict to
// [A-Z0-9_-], 3-22 characters (matches the `code varchar(22)` column). Kept
// in lockstep with that function -- same order of operations, same pattern
// -- so a code this accepts is never rejected by the server, and a code
// this shows as invalid instantly in the panel doesn't need a round trip to
// confirm it.
//
// Doing this client-side first (rather than only validating server-side) is
// what keeps garbage out of the stash above: a code stashed pre-login has to
// wait for the whole OAuth/magic-link round trip before the player would
// otherwise find out it was never going to be accepted.
//
// toUpperCase() can change a string's length (e.g. "ß" -> "SS"), so the
// length/charset check below runs on the already-uppercased candidate, not
// the raw input -- exactly matching the server, which does the same.
const CREATOR_CODE_PATTERN = /^[A-Z0-9_-]{3,22}$/;

export function normalizeCreatorCodeInput(raw: string): string | null {
  const candidate = raw.trim().toUpperCase();
  return CREATOR_CODE_PATTERN.test(candidate) ? candidate : null;
}

// Pulls the code segment out of a `/c/<code>` share-link path (see the
// module comment above -- this is the boot-time counterpart that fires
// before the player has necessarily logged in). Deliberately stops at
// extracting the raw segment rather than also normalizing it: a path that
// matches `/c/...` but carries an invalid code still needs its path
// stripped by the caller, which a single "valid code or null" return
// couldn't distinguish from "not a /c/ path at all".
//
// decodeURIComponent throws on a malformed percent-escape (e.g. a bare `%`
// from a link mangled by some other tool) -- since this runs unconditionally
// on every boot, that must degrade to "parse against the raw pathname"
// rather than crash the app before anything else has a chance to load. A
// raw, undecoded pathname either still matches the pattern (the common
// case -- most share links have nothing to decode) or fails to match and is
// treated as "not a /c/ link", both of which are safe outcomes.
export function parseCreatorCodePath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  const match = /^\/c\/([^/]+)$/.exec(decoded);
  return match ? match[1] : null;
}

// Boot-time entry point for the `/c/<code>` share link: stashes a valid code
// (silently drops an invalid one -- see parseCreatorCodePath above) and
// always strips the `/c/...` segment back to `/`, keeping any existing
// search/hash untouched. A no-op when the current path isn't a /c/ link, so
// Main.ts's handleUrl() can call this unconditionally on every load rather
// than needing its own branch. Reads/writes `window.location`/`history`
// directly (no DOM mounting required), which is what makes it callable
// straight from a test the same way tests/client/LoginResult.test.ts drives
// consumeLoginResult.
export function consumeCreatorCodePath(): void {
  const segment = parseCreatorCodePath(window.location.pathname);
  if (segment === null) return;

  const code = normalizeCreatorCodeInput(segment);
  if (code !== null) {
    stashPendingCreatorCode(code);
  }

  history.replaceState(
    null,
    "",
    "/" + window.location.search + window.location.hash,
  );
}

// Resumes a creator-code binding flow that was interrupted by a login
// redirect. Takes a plain callback rather than a modal/element reference
// (contrast SteamLink.ts's PendingLinkModal interface) because there is
// nothing structural to call besides "open the binding UI with this code" --
// keeping this a plain function with no Lit/DOM dependency is what makes it
// unit-testable without mounting anything. Returns true when a valid code
// was resumed (callers should treat that as "handled"), false when there was
// nothing pending or the stash had already expired.
export function resumePendingCreatorCode(
  open: (code: string) => void,
): boolean {
  const code = takePendingCreatorCode();
  if (code === null) return false;

  open(code);
  return true;
}
