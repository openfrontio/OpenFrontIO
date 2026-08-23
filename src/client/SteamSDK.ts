// Mirrors SteamTicketResult in openfront-desktop's src/main/steam.ts. The two
// repositories cannot import from each other, so this is a hand-kept copy; if
// you change one, change the other.
export type SteamTicketFailure = "unavailable" | "timeout" | "error";

export type SteamTicketResult =
  | { ok: true; ticket: string }
  | { ok: false; reason: SteamTicketFailure };

interface SteamBridge {
  getAuthTicket(): Promise<SteamTicketResult>;
  getUser(): Promise<{ steamId: string; name: string } | null>;
}

// window.openfrontDesktop is declared `unknown` by DesktopShell.ts (kept loose
// there on purpose). We know the shape the Electron preload exposes, so narrow
// it locally rather than re-declaring the global (a second `declare global`
// with a different type triggers TS2717).
function steamBridge(): SteamBridge | undefined {
  const desktop = window.openfrontDesktop as
    | { steam?: SteamBridge }
    | undefined;
  return desktop?.steam;
}

// Thin renderer wrapper over the desktop shell's Steam bridge. Mirrors
// CrazyGamesSDK; the native work lives in the Electron main process.
class SteamSDK {
  isOnSteam(): boolean {
    return steamBridge() !== undefined;
  }

  async getTicket(): Promise<SteamTicketResult> {
    const bridge = steamBridge();
    if (!bridge) return { ok: false, reason: "unavailable" };
    try {
      return await bridge.getAuthTicket();
    } catch {
      // The IPC call itself failed, which tells us nothing about Steam.
      return { ok: false, reason: "error" };
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
