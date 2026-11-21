import type {
  PlayerCardRefs,
  TrackerStat,
} from "@openfront/shared/PlayerCardSchemas";
import { invalidateUserMe } from "./Api";
import { getApiBase } from "./ApiBase";
import { getAuthHeader, logOut } from "./Auth";
import { broadcastFreshUserMe } from "./Cosmetics";

// Saving the player card loadout and the "Mute taunts" setting.

export interface CardLoadoutBody {
  background: string | null;
  title: string | null;
  taunt: string | null;
  trackers: TrackerStat[];
}

// A saved loadout as /users/@me would carry it, for patching a copy in hand
// (when the refresh after a save fails, it still has to show the save).
// Tracker values come from `previous`; a newly equipped one reads 0 until
// the next /users/@me.
export function cardRefsFromLoadout(
  loadout: CardLoadoutBody,
  previous: PlayerCardRefs | null | undefined,
): PlayerCardRefs {
  const values = new Map(
    (previous?.trackers ?? []).map((t) => [t.stat, t.value] as const),
  );
  const refs: PlayerCardRefs = {
    trackers: loadout.trackers.map((stat) => ({
      stat,
      value: values.get(stat) ?? 0,
    })),
  };
  if (loadout.background !== null) refs.background = loadout.background;
  if (loadout.title !== null) refs.title = loadout.title;
  if (loadout.taunt !== null) refs.taunt = loadout.taunt;
  return refs;
}

export type SaveCardResult =
  | { ok: true; loadout: CardLoadoutBody }
  // 403: the player doesn't own the card, or an item in `slot`.
  | { ok: false; error: "no_card" }
  | { ok: false; error: "not_owned"; slot: string }
  // 401: the session is gone; logOut() has already run.
  | { ok: false; error: "logged_out" }
  | { ok: false; error: "failed" }
  // Not sent: `stillWanted` said no once the bearer token was in hand.
  | { ok: false; error: "cancelled" };

// PUT /users/@me/card: the whole loadout (idempotent). On success it
// broadcasts a fresh /users/@me before returning, so everything holding the
// player's card (the Account header, a recreated My Card tab, other editors)
// reads the saved one. A failed refresh doesn't fail the save.
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

// PUT /users/@me/taunts_muted. True when saved.
export async function saveTauntsMuted(muted: boolean): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/users/@me/taunts_muted`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ muted }),
    });
    if (!response.ok) return false;
    invalidateUserMe();
    return true;
  } catch {
    return false;
  }
}
