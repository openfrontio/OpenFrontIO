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

export type DesktopUpdateStatus =
  | "checking"
  | "current"
  | "downloading"
  | "staged"
  | "blocked"
  | "failed";

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  bytes: number;
  total: number;
  error?: { kind: string; message: string };
}

export interface DesktopUpdateBridge {
  subscribe: (cb: (state: DesktopUpdateState) => void) => () => void;
  apply: () => Promise<void>;
  retry: () => Promise<void>;
  setInGame?: (inGame: boolean) => Promise<void>;
}

// Narrowed locally rather than re-declaring the global -- see the note on
// VersionBridge above for why (TS2717).
type UpdateBridgeHolder = { update?: DesktopUpdateBridge };

/**
 * The shell's runtime-update bridge, or null when it is unavailable -- on the
 * web, and on any desktop shell older than the one that introduced it.
 *
 * Returning null rather than throwing is the contract: the shell ships in the
 * Steam depot and updates on Steam's schedule, while this client updates at
 * runtime, so a client newer than its shell is an ordinary situation and must
 * degrade rather than break.
 */
export function desktopUpdate(): DesktopUpdateBridge | null {
  const desktop = window.openfrontDesktop as UpdateBridgeHolder | undefined;
  return desktop?.update ?? null;
}

/**
 * Whether multiplayer should be available in a given update state.
 *
 * Gate when the player has a remedy, not merely when there is a problem:
 * downloading -> wait, staged -> reload, failed -> retry. `blocked` means the
 * shell is too old and only a Steam depot push fixes it, so gating there would
 * lock a paying player out for hours with no action available.
 *
 * This duplicates multiplayerAllowed in openfront-desktop's
 * src/main/update/state.ts. The two repositories cannot import from each other;
 * if you change one, change the other.
 */
export function multiplayerAllowed(status: DesktopUpdateStatus): boolean {
  return status === "current" || status === "checking" || status === "blocked";
}
