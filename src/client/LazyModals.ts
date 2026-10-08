import { whenPageIdle } from "./WhenPageIdle";

/**
 * The modals the homepage opens only on request are their own chunks, so the
 * homepage loads without them. Their elements are in index.html from the
 * start and upgrade once their module arrives: showPage and the modal router
 * load it before opening one, and prefetchModals loads them all in the
 * background once the page has loaded, so a click rarely waits on one.
 *
 * Modals that open each other (the account, clan, profile and game-stats
 * views) import each other, so a handoff between them never waits.
 */
const modules: Record<string, () => Promise<unknown>> = {
  "account-modal": () => import("./AccountModal"),
  "account-settings-modal": () => import("./AccountSettingsModal"),
  "change-username-modal": () => import("./ChangeUsernameModal"),
  "clan-modal": () => import("./ClanModal"),
  "game-stats-modal": () => import("./GameStatsModal"),
  "help-modal": () => import("./HelpModal"),
  "inventory-modal": () => import("./InventoryModal"),
  "leaderboard-modal": () => import("./LeaderboardModal"),
  "news-modal": () => import("./NewsModal"),
  "player-profile-modal": () => import("./PlayerProfileModal"),
  "ranked-modal": () => import("./components/RankedModal"),
  "subscription-modal": () => import("./SubscriptionModal"),
  "troubleshooting-modal": () => import("./TroubleshootingModal"),
  "user-setting": () => import("./UserSettingModal"),
};

/** Loads the module that defines `tag`, if it's one loaded on demand. */
export async function loadModal(tag: string): Promise<void> {
  await modules[tag]?.();
}

export function prefetchModals(): void {
  // A failed prefetch is left to the open that needs the chunk.
  whenPageIdle(() => {
    for (const load of Object.values(modules)) void load().catch(() => {});
  });
}
