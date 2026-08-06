// The Electron desktop (Steam) shell exposes this global via a contextBridge
// preload script — see openfront-desktop's src/preload/preload.ts. Its mere
// presence is a reliable signal we're running inside that shell, since only
// the desktop build's preload script ever sets it.
declare global {
  interface Window {
    openfrontDesktop?: unknown;
  }
}

export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && window.openfrontDesktop !== undefined;
}

// The shell's own version, distinct from the game version this client was
// built from. Narrowed locally rather than re-declaring the global -- see
// SteamSDK.ts for why (TS2717).
type VersionBridge = { version?: () => Promise<string> };

// The version label is purely cosmetic and must never block client
// initialisation. The bridge below is implemented in a different (private)
// repository, so this public repo cannot enforce that its version() call
// ever settles -- race it against a short timeout and fall back to null if
// the timeout wins. 500ms is ample for an IPC round trip.
const DESKTOP_VERSION_TIMEOUT_MS = 500;

export async function desktopVersion(): Promise<string | null> {
  const desktop = window.openfrontDesktop as VersionBridge | undefined;
  if (!desktop?.version) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DESKTOP_VERSION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([desktop.version(), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Composes the version label shown in the nav bar. On Steam the game version
 * stays primary so a player's version reads the same across web and Steam,
 * with the shell version as subtext: "v0.33.1 (Steam v0.2.0)".
 */
export function composeVersionDisplay(
  gameVersion: string,
  shellVersion: string | null,
): string {
  if (!shellVersion) return gameVersion;
  const trimmed = shellVersion.trim();
  if (trimmed === "") return gameVersion;
  const withV = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  return `${gameVersion} (Steam ${withV})`;
}
