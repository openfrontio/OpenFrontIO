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

// The shell runs its own 5s watchdog on the native Steam ticket call and
// reports an accurate "timeout" reason when that fires. This outer bound
// must sit above that so the shell's own timeout wins the race in the normal
// case; it only fires when the IPC call itself is dead (e.g. the shell
// process wedged), where it maps to the same "timeout" reason the shell
// would have reported.
const GET_TICKET_TIMEOUT_MS = 8000;

// A shell older than this client may still return the legacy string | null
// shape getAuthTicket() had before SteamTicketResult existed. Normalise it
// rather than trust the shape, the same convention DesktopShell.ts follows
// for desktopVersion()/desktopUpdate(): a client newer than its shell must
// degrade rather than break.
function normaliseTicketResult(value: unknown): SteamTicketResult {
  if (typeof value === "string") {
    return value.length > 0
      ? { ok: true, ticket: value }
      : { ok: false, reason: "unavailable" };
  }
  if (value === null || value === undefined) {
    return { ok: false, reason: "unavailable" };
  }
  if (typeof value === "object" && "ok" in value) {
    return value as SteamTicketResult;
  }
  return { ok: false, reason: "error" };
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<SteamTicketResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ ok: false, reason: "timeout" }),
        GET_TICKET_TIMEOUT_MS,
      );
    });
    try {
      const result = await Promise.race([
        bridge.getAuthTicket().then(normaliseTicketResult),
        timeout,
      ]);
      return result;
    } catch {
      // The IPC call itself failed, which tells us nothing about Steam.
      return { ok: false, reason: "error" };
    } finally {
      clearTimeout(timer);
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
