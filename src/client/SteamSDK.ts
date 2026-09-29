// Mirrors SteamTicketResult in openfront-desktop's src/main/steam.ts. The two
// repositories cannot import from each other, so this is a hand-kept copy; if
// you change one, change the other.
export type SteamTicketFailure =
  | "unavailable"
  | "timeout"
  | "error"
  // The last three are not Steam failures: Steam is fine and a ticket is
  // mintable. They are the shell declining to hand us one, because exchanging
  // it would permanently bind this Steam id to a new account. Three values
  // rather than one because they are three different situations, and only the
  // first is "the player must set up an account".
  | "needs-account"
  | "ticket-rejected"
  | "api-unreachable";

export type SteamTicketResult =
  | { ok: true; ticket: string }
  | { ok: false; reason: SteamTicketFailure };

interface SteamBridge {
  steamId?: string;
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
    const candidate = value as { ok: unknown; ticket?: unknown };
    // Validate the success case rather than casting it: a malformed
    // { ok: true } without a usable ticket would otherwise be POSTed to
    // /auth/steam as-is. A malformed FAILURE needs no check here -- an
    // unrecognised reason is already handled by ticketReason's default.
    if (candidate.ok === true) {
      return typeof candidate.ticket === "string" && candidate.ticket.length > 0
        ? { ok: true, ticket: candidate.ticket }
        : { ok: false, reason: "error" };
    }
    if (candidate.ok === false) {
      return value as SteamTicketResult;
    }
  }
  return { ok: false, reason: "error" };
}

// Thin renderer wrapper over the desktop shell's Steam bridge. Mirrors
// CrazyGamesSDK; the native work lives in the Electron main process.
class SteamSDK {
  private cachedUser: { steamId: string; name: string } | null = null;

  constructor() {
    if (typeof window !== "undefined" && this.isOnSteam()) {
      void this.getUser();
    }
  }

  getSteamIdSync(): string | null {
    if (this.cachedUser?.steamId) return this.cachedUser.steamId;
    const bridge = steamBridge();
    if (typeof bridge?.steamId === "string") {
      return bridge.steamId;
    }
    return null;
  }

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
      const user = await bridge.getUser();
      if (user?.steamId) {
        this.cachedUser = user;
      }
      return user;
    } catch {
      return null;
    }
  }
}

export const steamSDK = new SteamSDK();
