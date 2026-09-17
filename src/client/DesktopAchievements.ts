// Thin renderer wrapper over the desktop shell's achievements bridge. Mirrors
// DesktopPresence.ts; all platform-specific work lives in the shell.
//
// This module deliberately knows NOTHING about Steam or any other platform.
// It reports which achievements the server says this player has earned; what
// the shell makes of them is the shell's business.

// The shell that provides this namespace declares shell.api >= 4. Anything
// older either predates the namespace or is a shell exposing half a surface
// without having said so -- refuse both, rather than calling whatever happens
// to be present. See DesktopPresence.isAvailable for the same reasoning.
const ACHIEVEMENTS_API = 4;

interface AchievementsBridge {
  achievements?: { unlock(names: string[]): Promise<void> };
  shell?: { api?: number };
}

// Narrowed locally rather than re-declaring the global -- a second
// `declare global` with a different type triggers TS2717. See DesktopShell.ts.
function bridge(): AchievementsBridge | undefined {
  return window.openfrontDesktop as AchievementsBridge | undefined;
}

class DesktopAchievements {
  isAvailable(): boolean {
    const api = bridge()?.shell?.api;
    return typeof api === "number" && api >= ACHIEVEMENTS_API;
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
