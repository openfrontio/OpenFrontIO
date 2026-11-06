import type { SteamSkinDrop } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
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

/**
 * The drop to announce, with its catalog entry, or null when there is none to
 * show. The catalog is only fetched when the API names a drop, so every other
 * player pays nothing. A catalog that fails to load, or lacks the item, is an
 * unresolved item: no popup, nothing marked seen, the next interrupt runs.
 */
export async function steamSkinDropFor(
  drop: SteamSkinDrop | null | undefined,
  fetchCatalog: () => Promise<Cosmetics | null>,
  resolve: (cosmetics: Cosmetics | null) => ResolvedCosmetic[],
): Promise<{ notice: string; resolved: ResolvedCosmetic } | null> {
  if (!drop) return null;
  const resolved = findSteamSkinDrop(drop, resolve(await fetchCatalog()));
  return resolved === null ? null : { notice: drop.notice, resolved };
}

/**
 * Loads the lazy popup and shows it. A chunk that will not load, or an element
 * that is not on the page, resolves "abandoned" so nothing is marked seen and
 * the player is told next launch.
 */
export async function showSteamSkinDrop(
  resolved: ResolvedCosmetic,
  load: () => Promise<void>,
  find: () => {
    show(resolved: ResolvedCosmetic): Promise<SteamSkinDropAnswer>;
  } | null,
): Promise<SteamSkinDropAnswer> {
  try {
    await load();
  } catch (err) {
    console.error("steam-skin-drop-modal failed to load:", err);
    return "abandoned";
  }
  return (await find()?.show(resolved)) ?? "abandoned";
}

/**
 * Resolves the drop and decides whether the homepage is still clean, in an
 * order that cannot go stale: check, fetch the catalog, check again with
 * nothing awaited after. A join that starts during the fetch leaves
 * `cleanHomepage` false, so no interrupt opens over a starting game. The
 * catalog is fetched only on a clean page, for a drop due this launch.
 */
export async function steamSkinDropWhenClean(
  drop: SteamSkinDrop | null | undefined,
  homepageIsClean: () => boolean,
  fetchCatalog: () => Promise<Cosmetics | null>,
  resolve: (cosmetics: Cosmetics | null) => ResolvedCosmetic[],
): Promise<{
  steamSkinDrop: { notice: string; resolved: ResolvedCosmetic } | null;
  cleanHomepage: boolean;
}> {
  const due =
    drop && homepageIsClean() && steamSkinDropDueThisLaunch(drop.notice);
  const steamSkinDrop = due
    ? await steamSkinDropFor(drop, fetchCatalog, resolve)
    : null;
  return { steamSkinDrop, cleanHomepage: homepageIsClean() };
}
