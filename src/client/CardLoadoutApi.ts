import type { TrackerStat } from "@openfront/shared/PlayerCardSchemas";
import { getApiBase } from "./ApiBase";
import { getAuthHeader, logOut } from "./Auth";
import { broadcastFreshUserMe } from "./Cosmetics";

// Saving the player card loadout.

export interface CardLoadoutBody {
  background: string | null;
  title: string | null;
  taunt: string | null;
  trackers: TrackerStat[];
}

export type SaveCardResult =
  | { ok: true; loadout: CardLoadoutBody }
  // 403: the player doesn't own the card, or an item in `slot`.
  | { ok: false; error: "no_card" }
  | { ok: false; error: "not_owned"; slot: string }
  // 401: the session is gone; logOut() has already run.
  | { ok: false; error: "logged_out" }
  | { ok: false; error: "failed" }
  // Not sent: `stillWanted` said no once the bearer token was in hand (or
  // answered 401 once it no longer was wanted).
  | { ok: false; error: "cancelled" };

// PUT /users/@me/card: the whole loadout (idempotent). On success it
// broadcasts a fresh /users/@me before returning, so everything holding the
// player's card (the Account header, the Inventory's card editor) reads the
// saved one. A failed refresh doesn't fail the save.
//
// `stillWanted` is asked once the bearer token is in hand, just before the
// PUT: reading the token can wait on a JWT refresh, and a sign-out (or
// another sign-in) during it must not send this loadout under the new
// session's token.
export async function saveCardLoadout(
  loadout: CardLoadoutBody,
  stillWanted: () => boolean = () => true,
): Promise<SaveCardResult> {
  try {
    const authorization = await getAuthHeader();
    if (!stillWanted()) return { ok: false, error: "cancelled" };
    const response = await fetch(`${getApiBase()}/users/@me/card`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify(loadout),
    });
    if (response.status === 401) {
      // A 401 for a token that is no longer the session's (signed out and
      // back in, or into another account, while the PUT was out) says
      // nothing about the session now, so it mustn't end it.
      if (!stillWanted()) return { ok: false, error: "cancelled" };
      await logOut();
      return { ok: false, error: "logged_out" };
    }
    if (response.status === 403) {
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
        slot?: unknown;
      } | null;
      if (body?.error === "no_card") return { ok: false, error: "no_card" };
      if (body?.error === "not_owned") {
        return {
          ok: false,
          error: "not_owned",
          slot: typeof body.slot === "string" ? body.slot : "",
        };
      }
      return { ok: false, error: "failed" };
    }
    if (!response.ok) return { ok: false, error: "failed" };
    const stored = (await response.json()) as CardLoadoutBody;
    await broadcastFreshUserMe().catch(() => false);
    return { ok: true, loadout: stored };
  } catch {
    return { ok: false, error: "failed" };
  }
}
