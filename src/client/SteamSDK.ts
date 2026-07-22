interface SteamBridge {
  getAuthTicket(): Promise<string | null>;
  getUser(): Promise<{ steamId: string; name: string } | null>;
}

// window.openfrontDesktop is declared `unknown` by DesktopShell.ts (kept loose
// there on purpose). We know the shape the Electron preload exposes, so narrow
// it locally rather than re-declaring the global (a second `declare global`
// with a different type triggers TS2717).
function steamBridge(): SteamBridge | undefined {
  const desktop = window.openfrontDesktop as { steam?: SteamBridge } | undefined;
  return desktop?.steam;
}

// Thin renderer wrapper over the desktop shell's Steam bridge. Mirrors
// CrazyGamesSDK; the native work lives in the Electron main process.
class SteamSDK {
  isOnSteam(): boolean {
    return steamBridge() !== undefined;
  }

  async getTicket(): Promise<string | null> {
    const bridge = steamBridge();
    if (!bridge) return null;
    try {
      return await bridge.getAuthTicket();
    } catch {
      return null;
    }
  }

  async getUser(): Promise<{ steamId: string; name: string } | null> {
    const bridge = steamBridge();
    if (!bridge) return null;
    try {
      return await bridge.getUser();
    } catch {
      return null;
    }
  }
}

export const steamSDK = new SteamSDK();
