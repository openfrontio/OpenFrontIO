import { UnsecuredJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthHeader,
  getDesktopSessionState,
  logOut,
  retrySteamSignIn,
} from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";
import { steamSDK } from "../../src/client/SteamSDK";

function setBootstrapConfig() {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.dev",
    instanceId: "d",
    gitCommit: "t",
  };
  ClientEnv.reset();
}

beforeEach(async () => {
  setBootstrapConfig();
  await logOut();
  vi.restoreAllMocks();
});

describe("Steam login", () => {
  it("exchanges a Steam ticket for a session JWT via POST /auth/steam", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getTicket").mockResolvedValue({
      ok: true,
      ticket: "ticket123",
    });

    const jwt = new UnsecuredJWT({
      jti: "some-id",
      sub: "AAAAAAAAAAAAAAAAAAAAAA",
      iat: Math.floor(Date.now() / 1000),
      iss: "https://api.openfront.dev",
      aud: "openfront.dev",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }).encode();

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ jwt, expiresIn: 900 }), { status: 200 }),
      );

    const header = await getAuthHeader();

    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/steam");
    expect(header).toBe(`Bearer ${jwt}`);
    expect(getDesktopSessionState()).toEqual({ status: "signed-in" });
  });

  // Replaces "falls through to the guest/refresh flow when no Steam ticket is
  // available". The Electron profile has no refresh cookie, so that
  // fallthrough was a guaranteed 401 that then ran logOut() and dropped the
  // player's persistent ID. The Steam branch is now terminal.
  it("does not fall through to /auth/refresh when the ticket fails", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getTicket").mockResolvedValue({
      ok: false,
      reason: "timeout",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await getAuthHeader();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", "steam-unavailable"],
    ["timeout", "steam-wedged"],
    ["error", "steam-error"],
  ] as const)(
    "maps ticket failure %s to session reason %s",
    async (ticketReason, sessionReason) => {
      vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
      vi.spyOn(steamSDK, "getTicket").mockResolvedValue({
        ok: false,
        reason: ticketReason,
      });

      await getAuthHeader();

      expect(getDesktopSessionState()).toEqual({
        status: "signed-out",
        reason: sessionReason,
      });
    },
  );

  it.each([
    [401, "steam-ticket-rejected"],
    [500, "steam-backend"],
  ] as const)(
    "maps /auth/steam %i to session reason %s",
    async (status, sessionReason) => {
      vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
      vi.spyOn(steamSDK, "getTicket").mockResolvedValue({
        ok: true,
        ticket: "t",
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status }),
      );

      await getAuthHeader();

      expect(getDesktopSessionState()).toEqual({
        status: "signed-out",
        reason: sessionReason,
      });
    },
  );

  it("maps a thrown fetch to the network reason", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getTicket").mockResolvedValue({
      ok: true,
      ticket: "t",
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await getAuthHeader();

    expect(getDesktopSessionState()).toEqual({
      status: "signed-out",
      reason: "network",
    });
  });

  it("publishes each transition as a desktop-session-state event", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getTicket").mockResolvedValue({
      ok: false,
      reason: "timeout",
    });
    const seen: unknown[] = [];
    document.addEventListener("desktop-session-state", (e) =>
      seen.push((e as CustomEvent).detail),
    );

    await getAuthHeader();

    expect(seen).toContainEqual({
      status: "signed-out",
      reason: "steam-wedged",
    });
  });

  it("runs one sign-in when retry is called twice concurrently", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    const getTicket = vi
      .spyOn(steamSDK, "getTicket")
      .mockResolvedValue({ ok: false, reason: "timeout" });

    await Promise.all([retrySteamSignIn(), retrySteamSignIn()]);

    expect(getTicket).toHaveBeenCalledTimes(1);
  });
});
