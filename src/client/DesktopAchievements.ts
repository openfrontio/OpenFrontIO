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
  // DesktopPresence.isAvailable is. Do not "fix" this back to an api number.
  //
  // The api ladder is owned by the shell repository, not this one, so any
  // level named here is a guess about another repository's future and can go
  // stale without this repository noticing. Detecting the method cannot: a
  // shell that can take achievements has it, and one that cannot does not.
  //
  // Stricter than DesktopPresence because the cost of a wrong gate differs. A
  // mis-gated presence call degrades a cosmetic feature for one session; a
  // mis-gated achievements call reports "delivered" for names nothing
  // received, which AchievementSignal then records permanently -- silent,
  // irreversible loss. Full account: the shell repository's achievements
  // design doc, "Gated on the method being present".
  isAvailable(): boolean {
    return typeof bridge()?.achievements?.unlock === "function";
  }

  /**
   * Hand names to the shell. Resolves true only once the shell has taken them.
   *
   * The caller records what it delivers and never re-sends a recorded name,
   * so a call the shell could not honour has to be reported as a failure
   * rather than swallowed: a name recorded without a delivery is lost for
   * good. The shell filters the list against what the platform already holds,
   * so re-sending one it already has is a no-op and always safe.
   */
  async unlock(names: string[]): Promise<boolean> {
    if (names.length === 0) return false;
    if (!this.isAvailable()) return false;
    try {
      await bridge()?.achievements?.unlock(names);
      return true;
    } catch {
      // A bridge that throws synchronously, or whose handler rejects -- an
      // uninitialised platform library, a failing native call -- must not take
      // the game down. Achievements are cosmetic; the caller retries.
      return false;
    }
  }
}

export const desktopAchievements = new DesktopAchievements();
