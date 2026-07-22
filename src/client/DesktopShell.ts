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
