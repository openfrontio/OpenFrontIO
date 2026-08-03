import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";

// The desktop Electron shell's account-linking gate opens the browser at
// `<site>#steam-link?token=<opaque>`. The hash (never a query string, so it
// isn't sent to any server, and never a path, so no routing needed) carries a
// short-lived, single-use ticket that ties this browser session to the
// player's Steam account. See docs/superpowers/sdd for the full handoff.
const LINK_HASH_PREFIX = "#steam-link?";

const PENDING_LINK_KEY = "steam-link-pending";

// Pulls the opaque link token out of the URL hash the desktop shell opens the
// browser at. Returns null for any hash that isn't the steam-link one
// (including no token param), so callers can call this unconditionally on
// every page load.
export function parseSteamLinkToken(hash: string): string | null {
  if (!hash.startsWith(LINK_HASH_PREFIX)) return null;
  const query = hash.slice(LINK_HASH_PREFIX.length);
  return new URLSearchParams(query).get("token");
}

// The token often needs to survive a login (magic link, Discord/Google OAuth
// redirect) before it can be redeemed against an authenticated account, so it
// is stashed in localStorage rather than held in memory.
export function stashPendingLink(token: string): void {
  localStorage.setItem(PENDING_LINK_KEY, token);
}

// Consumed on read: once taken, a stale/already-handled token can't re-fire
// on a later page load.
export function takePendingLink(): string | null {
  const token = localStorage.getItem(PENDING_LINK_KEY);
  if (token === null) return null;
  localStorage.removeItem(PENDING_LINK_KEY);
  return token;
}

export type RedeemSteamLinkResult =
  | { ok: true }
  | { ok: false; reason: string };

// POST /auth/steam/link — redeems a link ticket against the currently
// logged-in account. Idempotent on the server (re-redeeming an already-linked
// pair also returns 200), so no special-casing is needed here for that case.
//
// Status mapping:
//   200 -> ok
//   409 -> refused; `reason` is the server's machine-readable code verbatim
//          (e.g. "steam_has_progress") so the UI can render a specific
//          message. Never mapped to a generic failure or reworded.
//   410 -> the ticket expired; mapped to reason "expired".
//   anything else (4xx/5xx/network error) -> reason "failed". Deliberately
//   distinct from "expired"/the 409 reasons: a later task (429 throttling)
//   needs to tell these apart, so they must not collapse into one bucket.
export async function redeemSteamLink(
  token: string,
): Promise<RedeemSteamLinkResult> {
  try {
    const response = await fetch(`${getApiBase()}/auth/steam/link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ token }),
    });

    if (response.status === 200) {
      return { ok: true };
    }

    if (response.status === 409) {
      const body = await response.json().catch(() => null);
      const reason = typeof body?.reason === "string" ? body.reason : "failed";
      return { ok: false, reason };
    }

    if (response.status === 410) {
      return { ok: false, reason: "expired" };
    }

    console.error(
      "redeemSteamLink: request failed",
      response.status,
      response.statusText,
    );
    return { ok: false, reason: "failed" };
  } catch (e) {
    console.error("redeemSteamLink: request failed", e);
    return { ok: false, reason: "failed" };
  }
}
