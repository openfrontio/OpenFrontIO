interface SteamBridge {
  getAuthTicket(): Promise<string | null>;
  getUser(): Promise<{ steamId: string; name: string } | null>;
}

declare global {
  interface Window {
    openfrontDesktop?: { steam?: SteamBridge };
  }
}

// Thin renderer wrapper over the desktop shell's Steam bridge. Mirrors
// CrazyGamesSDK; the native work lives in the Electron main process.
class SteamSDK {
  isOnSteam(): boolean {
    return typeof window.openfrontDesktop?.steam !== "undefined";
  }

  async getTicket(): Promise<string | null> {
    if (!this.isOnSteam()) return null;
    try {
      return await window.openfrontDesktop!.steam!.getAuthTicket();
    } catch {
      return null;
    }
  }

  async getUser(): Promise<{ steamId: string; name: string } | null> {
    if (!this.isOnSteam()) return null;
    try {
      return await window.openfrontDesktop!.steam!.getUser();
    } catch {
      return null;
    }
  }
}

export const steamSDK = new SteamSDK();
