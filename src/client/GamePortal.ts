import { crazyGamesSDK } from "./CrazyGamesSDK";
import { pokiSDK } from "./PokiSDK";
import { viverseSDK } from "./ViverseSDK";

/** A signed-in portal account. VIVERSE gives us no avatar. */
export interface PortalUser {
  username: string;
  profilePictureUrl: string | null;
}

export type GamePortalName = "crazygames" | "poki" | "viverse";

/**
 * The web game portal (CrazyGames, Poki or VIVERSE) framing us. Portals own
 * the player's account, ads and gameplay events, and allow no purchases,
 * outside ads or our own login. Each call routes to the portal's SDK and is a
 * no-op (or null/false) on the open web.
 */
function active():
  | typeof crazyGamesSDK
  | typeof pokiSDK
  | typeof viverseSDK
  | null {
  // CrazyGames last: it claims any iframe it can't identify.
  if (pokiSDK.isOnPoki()) return pokiSDK;
  if (viverseSDK.isOnViverse()) return viverseSDK;
  if (crazyGamesSDK.isOnCrazyGames()) return crazyGamesSDK;
  return null;
}

export const gamePortal = {
  name(): GamePortalName | null {
    if (pokiSDK.isOnPoki()) return "poki";
    if (viverseSDK.isOnViverse()) return "viverse";
    if (crazyGamesSDK.isOnCrazyGames()) return "crazygames";
    return null;
  },
  isOnGamePortal: (): boolean => active() !== null,
  maybeInit: async (): Promise<void> => active()?.maybeInit(),
  getUsername: async (): Promise<string | null> =>
    (await active()?.getUsername()) ?? null,
  getUserToken: async (): Promise<string | null> =>
    (await active()?.getUserToken()) ?? null,
  getUserProfile: async (): Promise<PortalUser | null> =>
    (await active()?.getUserProfile()) ?? null,
  showAuthPrompt: async (): Promise<void> => {
    await active()?.showAuthPrompt();
  },
  addAuthListener: async (
    listener: (user: PortalUser | null) => void,
  ): Promise<void> => active()?.addAuthListener(listener),
  isInstantMultiplayer: async (): Promise<boolean> =>
    (await active()?.isInstantMultiplayer()) ?? false,
  gameplayStart: async (): Promise<void> => active()?.gameplayStart(),
  gameplayStop: async (): Promise<void> => active()?.gameplayStop(),
  happytime: async (): Promise<void> => active()?.happytime(),
  loadingStart: (): void => active()?.loadingStart(),
  loadingStop: (): void => active()?.loadingStop(),
  showInviteButton: (gameId: string): void => {
    active()?.showInviteButton(gameId);
  },
  hideInviteButton: (): void => active()?.hideInviteButton(),
  createInviteLink: async (gameId: string): Promise<string | null> =>
    (await active()?.createInviteLink(gameId)) ?? null,
  getInviteGameId: async (): Promise<string | null> =>
    (await active()?.getInviteGameId()) ?? null,
  requestMidgameAd: async (): Promise<void> => active()?.requestMidgameAd(),
};
