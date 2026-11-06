import type { SteamSkinDrop } from "@openfront/shared/ApiSchemas";
import type { ResolvedCosmetic } from "./Cosmetics";

/**
 * What the player chose in the Steam skin popup. "abandoned" is not a choice:
 * the popup was removed or replaced before they answered, so nothing is
 * recorded and the notice is still owed.
 */
export type SteamSkinDropAnswer = "claim" | "equip" | "dismiss" | "abandoned";

/** Translation keys the Steam skin popup renders through. */
export const STEAM_SKIN_DROP_KEYS = {
  message: "steam_skin_drop.message",
  claim: "steam_skin_drop.claim",
  claimEquip: "steam_skin_drop.claim_equip",
  close: "steam_skin_drop.close",
  previewPrompt: "steam_skin_drop.preview_prompt",
  previewConfirm: "steam_skin_drop.preview_confirm",
  previewBack: "steam_skin_drop.preview_back",
} as const;

/**
 * The catalog entry for this month's drop, or null when the API names nothing
 * or the catalog (loaded separately) does not carry it.
 */
export function findSteamSkinDrop(
  drop: SteamSkinDrop | null | undefined,
  cosmetics: ResolvedCosmetic[],
): ResolvedCosmetic | null {
  if (!drop) return null;
  const key =
    drop.type === "skin"
      ? `skin:${drop.name}`
      : drop.colorPalette === null
        ? `pattern:${drop.name}`
        : `pattern:${drop.name}:${drop.colorPalette}`;
  return cosmetics.find((c) => c.key === key) ?? null;
}

// /users/@me is re-read several times per launch and the seen POST is fire
// and forget, so a re-read can still carry a notice the player just closed.
// One showing per notice per launch; a launch that never showed it still owes
// it, because nothing was marked seen.
const shownThisLaunch = new Set<string>();

export function steamSkinDropDueThisLaunch(notice: string): boolean {
  return !shownThisLaunch.has(notice);
}

export function steamSkinDropShown(notice: string): void {
  shownThisLaunch.add(notice);
}

export function resetSteamSkinDropForTest(): void {
  shownThisLaunch.clear();
}

/**
 * Does the popup have anything to say yet? The notice is marked seen once
 * answered, so a key echoed back before the language files land would spend
 * the one showing on a string nobody can read.
 */
export function steamSkinDropStringsReady(
  translate: (key: string) => string,
): boolean {
  return Object.values(STEAM_SKIN_DROP_KEYS).every(
    (key) => translate(key) !== key,
  );
}
