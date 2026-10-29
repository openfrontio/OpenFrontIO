import { gamePortal } from "./GamePortal";
import { getGamesPlayed } from "./Utils";

/**
 * Whether this load drops the player straight into the onboarding tutorial
 * (docs/OnboardingTutorial.md): a new player on Poki or CrazyGames, who
 * expects to be playing within seconds. Not when the portal sent them to a
 * lobby (an invite, or CrazyGames' instant multiplayer). Joining the tutorial
 * counts as a game played, so it happens once.
 */
export async function shouldStartPortalTutorial(): Promise<boolean> {
  if (!gamePortal.isOnGamePortal() || getGamesPlayed() > 0) return false;
  if ((await gamePortal.getInviteGameId()) !== null) return false;
  return !(await gamePortal.isInstantMultiplayer());
}
