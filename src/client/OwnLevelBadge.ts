import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { LevelBadge } from "@openfront/shared/LevelBadgeWire";
import { getUserMe } from "./Api";

// The viewer's OWN level badge while they hide their level ("hide my level").
//
// The game server leaves a hidden player's badge off the lobby roster for
// everyone, the player included, but they still see their own level. So their
// client draws it from its own /users/@me instead — local only, nothing is
// sent anywhere. Undefined while the level is shown (the roster carries the
// badge then), for guests, and when progression is off.

export function ownHiddenLevelBadgeFrom(
  me: UserMeResponse | false,
): LevelBadge | undefined {
  if (me === false || me.player.levelHidden !== true) return undefined;
  const progress = me.player.progress;
  if (progress === undefined) return undefined;
  return {
    level: progress.level,
    prestige: progress.prestige,
    legend: progress.legend,
  };
}

let cached: LevelBadge | undefined;

// The last value refreshOwnHiddenLevelBadge() found, for synchronous readers
// (the in-game player panel).
export function ownHiddenLevelBadge(): LevelBadge | undefined {
  return cached;
}

// Re-reads it from /users/@me. getUserMe() is memoised, so this is normally
// answered from the profile already loaded at sign-in / join — no request.
export async function refreshOwnHiddenLevelBadge(): Promise<
  LevelBadge | undefined
> {
  cached = ownHiddenLevelBadgeFrom(await getUserMe());
  return cached;
}

document.addEventListener("session-cleared", () => {
  cached = undefined;
});
