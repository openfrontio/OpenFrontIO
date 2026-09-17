// Thin renderer wrapper over the desktop shell's achievements bridge. Mirrors
// DesktopPresence.ts; all platform-specific work lives in the shell.
//
// This module deliberately knows NOTHING about Steam or any other platform.
// It reports which achievements the server says this player has earned; what
// the shell makes of them is the shell's business.

interface AchievementsBridge {
  achievements?: { unlock(names: string[]): Promise<void> };
}

// Narrowed locally rather than re-declaring the global -- a second
// `declare global` with a different type triggers TS2717. See DesktopShell.ts.
function bridge(): AchievementsBridge | undefined {
  return window.openfrontDesktop as AchievementsBridge | undefined;
}

class DesktopAchievements {
  // Feature-detected, and deliberately NOT gated on `shell.api` the way
  // DesktopPresence.isAvailable is. Do not "fix" this back.
  //
  // The api ladder is owned by the shell repository, not this one. This module
  // was first written against `api >= 4` on the belief that 4 would be the
  // level introducing this namespace; 4 had in fact already shipped there
  // meaning something unrelated, so the gate passed on every shell in the
  // wild while no shell had an achievements namespace at all. Any number
  // picked here is a guess about another repository's future and can go stale
  // exactly that way. Detecting the method cannot: a shell that can take
  // achievements has it, and one that cannot does not.
  //
  // The two modules differ because the cost of being wrong differs. A
  // mis-gated presence call degrades a cosmetic feature for one session. A
  // mis-gated achievements call reports "delivered" for names that nothing
  // received, and AchievementSignal records those names permanently -- the
  // player's whole back catalogue is marked handed over while the platform
  // holds none of it, and no later run can tell. Silent, permanent data loss
  // is worth trusting less and checking more.
  isAvailable(): boolean {
    return typeof bridge()?.achievements?.unlock === "function";
  }

  // Fire-and-forget. The shell filters this list against what the platform
  // already holds, so sending a name that is already unlocked is a no-op and
  // re-sending is always safe.
  unlock(names: string[]): void {
    if (names.length === 0) return;
    if (!this.isAvailable()) return;
    try {
      void bridge()
        ?.achievements?.unlock(names)
        ?.catch(() => undefined);
    } catch {
      // A bridge that throws synchronously must not take the game down --
      // achievements are cosmetic.
    }
  }
}

export const desktopAchievements = new DesktopAchievements();
