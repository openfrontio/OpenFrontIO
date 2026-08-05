import { getApiBase } from "./Api";
import { getAuthHeader, logOut } from "./Auth";

// The desktop Electron shell's account-linking gate opens the browser at
// `<site>#steam-link?token=<opaque>`. The hash (never a query string, so it
// isn't sent to any server, and never a path, so no routing needed) carries a
// short-lived, single-use ticket that ties this browser session to the
// player's Steam account. See docs/superpowers/sdd for the full handoff.
const LINK_HASH_PREFIX = "#steam-link?";
const LINK_HASH = "#steam-link";

const PENDING_LINK_KEY = "steam-link-pending";

// Matches the link ticket's own server-side TTL. A stash older than this
// belongs to a ticket that is already dead, so resuming it can only produce
// a confirmation modal that errors -- which is worse than doing nothing,
// because it teaches players to dismiss that dialog without reading it, and
// that dialog is the security step of the whole flow.
//
// The server owns the authoritative value; this is a manually-kept copy, and
// so is the desktop shell's own (its gate has a TICKET_TTL_MS with the same
// 10 minutes). Changing the server's TTL means changing all three -- there is
// no shared source to import across three separate deployables. Erring long
// here is the safe direction: a stash that outlives its ticket resumes into a
// clean error, whereas one that expires early silently drops a link the
// player could still have completed.
const PENDING_LINK_TTL_MS = 10 * 60 * 1000;

// Pulls the opaque link token out of the URL hash the desktop shell opens the
// browser at. Returns null for any hash that isn't the steam-link one
// (including no token param), so callers can call this unconditionally on
// every page load.
export function parseSteamLinkToken(hash: string): string | null {
  if (!hash.startsWith(LINK_HASH_PREFIX)) return null;
  const query = hash.slice(LINK_HASH_PREFIX.length);
  return new URLSearchParams(query).get("token");
}

// True for any #steam-link hash, whether or not it carries a token. The gate
// also has a fallback path with no URL at all: when the browser handoff
// itself fails (wrong default browser, an odd Linux setup, Steam's overlay
// browser), the gate shows an 8-character code instead and tells the player
// to enter it on the website. The bare hash (no ?token=) is that code-entry
// destination — Main.ts opens the code-entry form for it, since
// parseSteamLinkToken above returns null and there is otherwise nothing to
// route to.
export function isSteamLinkHash(hash: string): boolean {
  return hash === LINK_HASH || hash.startsWith(LINK_HASH_PREFIX);
}

// The fallback code's alphabet, fixed by the desktop gate that generates it:
// 8 characters, uppercase, drawn from 23456789ABCDEFGHJKMNPQRSTVWXYZ. It
// deliberately excludes 0/O, 1/I/L and U so nothing is ever ambiguous by eye
// — a code containing one of those is malformed, not a typo to silently
// correct, so normalization below never remaps characters.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;

// Normalizes what a human is expected to type when copying the code by eye
// from the desktop gate's `XXXX-XXXX` display: any case, surrounding
// whitespace, and the hyphen (presentation-only — never part of the code
// itself). Nothing else is corrected; a genuinely wrong character stays
// wrong and isValidSteamLinkCode below will reject it.
export function normalizeSteamLinkCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/-/g, "");
}

// Validates an already-normalized code against the fixed alphabet/length.
// Callers should normalize first — this does not trim/uppercase/strip
// hyphens itself, so a raw, un-normalized string will usually fail here even
// if it would have been valid once normalized.
export function isValidSteamLinkCode(code: string): boolean {
  return (
    code.length === CODE_LENGTH &&
    [...code].every((ch) => CODE_ALPHABET.includes(ch))
  );
}

// What's stashed across a login redirect: either a token (from the browser
// handoff) or a bare intent to resume the code-entry form (there is no code
// to preserve — the player hadn't typed one yet when they were sent to log
// in). One localStorage slot, one flow in flight at a time, so the two are
// tagged rather than left to be told apart by shape — a stashed code-entry
// intent must never be mistaken for a token, or vice versa.
export type PendingLink =
  | { kind: "token"; token: string }
  | { kind: "code_entry" };

// The token often needs to survive a login (magic link, Discord/Google OAuth
// redirect) before it can be redeemed against an authenticated account, so it
// is stashed in localStorage rather than held in memory.
export function stashPendingLink(token: string): void {
  localStorage.setItem(
    PENDING_LINK_KEY,
    JSON.stringify({ kind: "token", token, stashedAt: Date.now() }),
  );
}

// The code-entry form has nothing to preserve but the fact that the player
// was on it — they're sent to log in before typing anything, so there's no
// draft/code value to carry across. See SteamLinkModal.openForCodeEntry().
export function stashPendingCodeEntry(): void {
  localStorage.setItem(
    PENDING_LINK_KEY,
    JSON.stringify({ kind: "code_entry", stashedAt: Date.now() }),
  );
}

// Consumed on read: once taken, a stale/already-handled entry can't re-fire
// on a later page load. Also expires on read: an entry older than
// PENDING_LINK_TTL_MS is discarded (still consumed, just returned as null)
// rather than resumed, since its link ticket is already dead server-side by
// then. Malformed/legacy storage (this used to hold a bare, unquoted token
// string before the kind discriminator existed, and before that, no
// timestamp at all) degrades to null rather than throwing — a leftover value
// from before this change must not crash every subsequent page load for
// whoever still has one.
export function takePendingLink(): PendingLink | null {
  const raw = localStorage.getItem(PENDING_LINK_KEY);
  if (raw === null) return null;
  localStorage.removeItem(PENDING_LINK_KEY);

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "kind" in parsed) {
      const candidate = parsed as {
        kind: unknown;
        token?: unknown;
        stashedAt?: unknown;
      };

      // A missing or non-numeric stashedAt means a pre-TTL entry (or a
      // corrupted one). Its age cannot be established, so it is treated as
      // expired rather than resumed -- see PENDING_LINK_TTL_MS.
      if (
        typeof candidate.stashedAt !== "number" ||
        Date.now() - candidate.stashedAt > PENDING_LINK_TTL_MS
      ) {
        return null;
      }

      if (candidate.kind === "token" && typeof candidate.token === "string") {
        return { kind: "token", token: candidate.token };
      }
      if (candidate.kind === "code_entry") {
        return { kind: "code_entry" };
      }
    }
  } catch {
    // Legacy raw-string format, or otherwise unparsable — fall through to
    // null below rather than throwing.
  }
  return null;
}

// The subset of SteamLinkModal's public surface resumePendingSteamLink needs
// — kept as a small structural interface (rather than importing the modal
// class itself) so this stays a plain, easily-unit-testable function with no
// dependency on Lit/the DOM.
export interface PendingLinkModal {
  openWithToken(token: string): Promise<void>;
  openForCodeEntry(): Promise<void>;
}

// Resumes a Steam-link flow that was interrupted by a login redirect
// (Discord/Google OAuth, magic link, or the account modal's own login form)
// — the one place both openWithToken's and openForCodeEntry's stashes get
// read back. Returns true when something was resumed (callers should treat
// that as "handled, stop routing further for this pass"), false when there
// was nothing pending. A missing modal (element not found/not yet defined)
// still consumes the stash — same "don't replay a stale entry" reasoning as
// takePendingLink itself — it just has nothing to hand the result to.
export function resumePendingSteamLink(
  modal: PendingLinkModal | undefined,
): boolean {
  const pending = takePendingLink();
  if (pending === null) return false;

  if (pending.kind === "token") {
    void modal?.openWithToken(pending.token);
  } else {
    void modal?.openForCodeEntry();
  }
  return true;
}

export type SteamLinkTicketResult =
  | { ok: true; personaName: string | null }
  | { ok: false };

// GET /auth/steam/link_ticket/:token — the Steam persona for the confirmation
// modal. Unauthenticated (anyone holding the token can poll it), and the
// server response is deliberately narrow: `state`/`reason` exist for the
// desktop gate's own polling, not for this — only `personaName` is read here.
// Returns { ok: false } on any error (unknown/expired token, network failure,
// bad shape) so the modal can render a single "couldn't load" state rather
// than guessing at a name.
//
// There is no equivalent lookup for the fallback code: the server only
// resolves a persona from the verified token the desktop minted, and a code
// alone carries nothing that keys into that (see redeemSteamLinkCode below,
// and SteamLinkModal's code-entry path — it shows the confirm step with no
// persona name rather than calling this with a code).
export async function fetchSteamLinkTicket(
  token: string,
): Promise<SteamLinkTicketResult> {
  try {
    const response = await fetch(
      `${getApiBase()}/auth/steam/link_ticket/${encodeURIComponent(token)}`,
      { headers: { Accept: "application/json" } },
    );
    if (response.status !== 200) {
      console.warn(
        "fetchSteamLinkTicket: unexpected status",
        response.status,
        response.statusText,
      );
      return { ok: false };
    }
    const body = await response.json();
    const personaName =
      typeof body?.personaName === "string" ? body.personaName : null;
    return { ok: true, personaName };
  } catch (e) {
    console.error("fetchSteamLinkTicket: request failed", e);
    return { ok: false };
  }
}

export type RedeemSteamLinkResult =
  | { ok: true }
  | { ok: false; reason: string; retryAfterSeconds?: number | null };

// POST /auth/steam/link — redeems a link ticket (token or code) against the
// currently logged-in account. Idempotent on the server (re-redeeming an
// already-linked pair also returns 200), so no special-casing is needed here
// for that case.
//
// Status mapping (shared by redeemSteamLink and redeemSteamLinkCode below —
// same endpoint, same throttle, just a different body shape):
//   200 -> ok
//   401 -> stale cached JWT; clears it via logOut() before failing, matching
//          the convention every other authenticated call in Api.ts follows
//          (e.g. setMarketingConsent, updateUsername, getMyTribeNames).
//   409 -> refused; `reason` is the server's machine-readable code verbatim
//          (e.g. "steam_has_progress") so the UI can render a specific
//          message. Never mapped to a generic failure or reworded.
//   410 -> the ticket expired; mapped to reason "expired".
//   429 -> the throttle tripped. This refuses even a correct token/code, so
//          it must never collapse into "failed" (which the UI renders as
//          "that was wrong" — actively misleading here). Mapped to reason
//          "rate_limited" with retryAfterSeconds parsed from the Retry-After
//          response header when present (RFC 9110 §10.2.3's delay-seconds
//          form; an HTTP-date form or a missing/stripped header both degrade
//          to null rather than throwing).
//   anything else (4xx/5xx/network error) -> reason "failed".
async function postSteamLinkRedeem(
  body: Record<string, string>,
): Promise<RedeemSteamLinkResult> {
  try {
    // Mirrors linkGoogle's guard in Auth.ts: getAuthHeader() returns "" rather
    // than throwing when logged out, and firing with an empty Authorization
    // header would just bounce off the server as a confusing failure.
    const authHeader = await getAuthHeader();
    if (authHeader === "") return { ok: false, reason: "failed" };

    const response = await fetch(`${getApiBase()}/auth/steam/link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 200) {
      return { ok: true };
    }

    if (response.status === 401) {
      await logOut();
      return { ok: false, reason: "failed" };
    }

    if (response.status === 409) {
      const responseBody = await response.json().catch(() => null);
      const reason =
        typeof responseBody?.reason === "string"
          ? responseBody.reason
          : "failed";
      return { ok: false, reason };
    }

    if (response.status === 410) {
      return { ok: false, reason: "expired" };
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterSeconds =
        retryAfterHeader !== null && /^\d+$/.test(retryAfterHeader)
          ? Number(retryAfterHeader)
          : null;
      return { ok: false, reason: "rate_limited", retryAfterSeconds };
    }

    // Name the shared function and the payload kind, not redeemSteamLink:
    // this runs for the fallback-code path too, and logging a code failure
    // under the token function's name points anyone triaging it at the
    // wrong flow.
    console.error(
      `postSteamLinkRedeem(${"code" in body ? "code" : "token"}): request failed`,
      response.status,
      response.statusText,
    );
    return { ok: false, reason: "failed" };
  } catch (e) {
    console.error(
      `postSteamLinkRedeem(${"code" in body ? "code" : "token"}): request failed`,
      e,
    );
    return { ok: false, reason: "failed" };
  }
}

export async function redeemSteamLink(
  token: string,
): Promise<RedeemSteamLinkResult> {
  return postSteamLinkRedeem({ token });
}

// Redeems the desktop gate's 8-character fallback code instead of the opaque
// token — same endpoint and status mapping as redeemSteamLink (see
// postSteamLinkRedeem), just `{ code }` in the body instead of `{ token }`.
// Callers are expected to have already normalized/validated the code (see
// normalizeSteamLinkCode/isValidSteamLinkCode); this sends whatever string
// it's given, same as redeemSteamLink does for a token.
export async function redeemSteamLinkCode(
  code: string,
): Promise<RedeemSteamLinkResult> {
  return postSteamLinkRedeem({ code });
}
