import type { TrackerStat } from "@openfront/shared/PlayerCardSchemas";
import { invalidateUserMe } from "./Api";
import { getApiBase } from "./ApiBase";
import { getAuthHeader, logOut } from "./Auth";

// Saving the player card loadout and the "Mute taunts" setting.

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
  | { ok: false; error: "failed" };

// PUT /users/@me/card: the whole loadout (idempotent). Invalidates the cached
// /users/@me on success so the next read has it.
export async function saveCardLoadout(
  loadout: CardLoadoutBody,
): Promise<SaveCardResult> {
  try {
    const response = await fetch(`${getApiBase()}/users/@me/card`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
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
    invalidateUserMe();
    return { ok: true, loadout: (await response.json()) as CardLoadoutBody };
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
