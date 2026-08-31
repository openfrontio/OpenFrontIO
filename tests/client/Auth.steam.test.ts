import { UnsecuredJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthHeader,
  getDesktopSessionState,
  logOut,
  retrySteamSignIn,
} from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";
import { multiplayerAllowedForSession } from "../../src/client/DesktopShell";
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

  // A shell older than this client's SteamTicketResult contract may still
  // return the legacy `string | null` shape from getAuthTicket(). These two
  // exercise SteamSDK's normalisation end-to-end through Auth.ts, so they
  // mock the raw bridge rather than steamSDK.getTicket directly.
  it("signs in via /auth/steam when the bridge returns a legacy string ticket", async () => {
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi.fn().mockResolvedValue("legacyhexticket"),
        getUser: vi.fn(),
      },
    };
    try {
      const jwt = new UnsecuredJWT({
        jti: "some-id",
        sub: "AAAAAAAAAAAAAAAAAAAAAA",
        iat: Math.floor(Date.now() / 1000),
        iss: "https://api.openfront.dev",
        aud: "openfront.dev",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }).encode();

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ jwt, expiresIn: 900 }), {
          status: 200,
        }),
      );

      const header = await getAuthHeader();

      expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/steam");
      expect(header).toBe(`Bearer ${jwt}`);
      expect(getDesktopSessionState()).toEqual({ status: "signed-in" });
    } finally {
      delete (window as any).openfrontDesktop;
    }
  });

  it("yields signed-out/steam-unavailable without throwing when the bridge returns a legacy null", async () => {
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi.fn().mockResolvedValue(null),
        getUser: vi.fn(),
      },
    };
    try {
      const fetchMock = vi.spyOn(globalThis, "fetch");

      await expect(getAuthHeader()).resolves.toBe("");

      expect(fetchMock).not.toHaveBeenCalled();
      expect(getDesktopSessionState()).toEqual({
        status: "signed-out",
        reason: "steam-unavailable",
      });
    } finally {
      delete (window as any).openfrontDesktop;
    }
  });

  // Replaces "falls through to the guest/refresh flow when no Steam ticket is
  // available". The Electron profile has no refresh cookie, so that
  // fallthrough was a guaranteed 401 that then ran logOut() and dropped the
  // player's persistent ID. The Steam branch is now terminal.
  // The initial sign-in had no equivalent of the retry path's guarantee: an
  // unexpected throw inside doRefreshJwt reaches userAuth's catch, which
  // returns false without publishing, leaving "unknown" -- which does NOT
  // gate, so multiplayer stays open and the join is refused by the server.
  it("settles a thrown initial sign-in instead of resting on unknown", async () => {
    // Drive the module to a genuine "unknown" first: __sessionState is
    // module-level and leaks between tests, and only a logOut from signed-in
    // produces "unknown". Asserting from a leaked state would prove nothing.
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    const getTicket = vi
      .spyOn(steamSDK, "getTicket")
      .mockResolvedValue({ ok: true, ticket: "t" });
    const jwt = new UnsecuredJWT({
      jti: "some-id",
      sub: "AAAAAAAAAAAAAAAAAAAAAA",
      iat: Math.floor(Date.now() / 1000),
      iss: "https://api.openfront.dev",
      aud: "openfront.dev",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }).encode();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jwt, expiresIn: 900 }), { status: 200 }),
    );
    await getAuthHeader();
    await logOut();
    expect(getDesktopSessionState()).toEqual({ status: "unknown" });

    // Now an unexpected throw inside doRefreshJwt. userAuth's catch swallows
    // it and returns false without publishing, so without the guarantee the
    // state would rest at "unknown" -- which does NOT gate, leaving multiplayer
    // open for a join the server will refuse.
    getTicket.mockImplementation(() => {
      throw new Error("boom");
    });

    await getAuthHeader();

    const state = getDesktopSessionState();
    expect(state).toEqual({ status: "signed-out", reason: "steam-error" });
    expect(multiplayerAllowedForSession(state)).toBe(false);
  });

  // A diagnosed failure must survive an UNRELATED logOut. getAuthHeader
  // returns "" when signed out, so any authenticated call still goes out and
  // still comes back 401, and Api.ts calls logOut() on 401 from 13 places.
  // Resetting to "unknown" there would un-gate multiplayer and hide the bar,
  // handing the player back the raw Turnstile error this work exists to remove.
  it("keeps a diagnosed signed-out state through an unrelated logOut", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getTicket").mockResolvedValue({
      ok: false,
      reason: "timeout",
    });
    await getAuthHeader();
    expect(getDesktopSessionState()).toEqual({
      status: "signed-out",
      reason: "steam-wedged",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    await logOut();

    expect(getDesktopSessionState()).toEqual({
      status: "signed-out",
      reason: "steam-wedged",
    });
  });

  // The boundary check in SteamSDK.getTicket exists so a malformed success
  // from a mismatched shell is never redeemed as a ticket. Asserted end to
  // end, not just at the SDK, because it is /auth/steam that would receive it.
  it("never POSTs /auth/steam for a malformed success from the bridge", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi.fn().mockResolvedValue({ ok: true, ticket: 1234 }),
        getUser: vi.fn(),
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await getAuthHeader();

    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/auth/steam");
    }
    expect(getDesktopSessionState()).toEqual({
      status: "signed-out",
      reason: "steam-error",
    });
  });

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
    // A Cloudflare WAF 403 (or a 429) still reached the server -- it is not a
    // transport failure, so it must not fall into the "network" bucket
    // ("Can't reach OpenFront. Check your connection.") the way it used to.
    [403, "steam-error"],
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

  // logOut() runs clearLocalSession() on ANY 401 from /users/@me, on key
  // rotation, and on an iss/aud claim mismatch -- none of which mean Steam
  // sign-in failed. It must not assert a Steam failure (which would gate
  // multiplayer and show a Steam-specific error for an unrelated event); it
  // must publish "unknown", which does not gate.
  // The narrow job of clearLocalSession: a state still claiming "signed-in"
  // after the session was dropped is a lie, so it is downgraded to "unknown".
  // "unknown" rather than a Steam failure, because logOut() fires on any 401,
  // key rotation, or claim mismatch -- none of which mean Steam failed.
  it("downgrades a stale signed-in to unknown after logOut on Steam", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getTicket").mockResolvedValue({
      ok: true,
      ticket: "t",
    });
    const jwt = new UnsecuredJWT({
      jti: "some-id",
      sub: "AAAAAAAAAAAAAAAAAAAAAA",
      iat: Math.floor(Date.now() / 1000),
      iss: "https://api.openfront.dev",
      aud: "openfront.dev",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }).encode();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ jwt, expiresIn: 900 }), { status: 200 }),
    );

    await getAuthHeader();
    expect(getDesktopSessionState()).toEqual({ status: "signed-in" });

    await logOut();

    const state = getDesktopSessionState();
    expect(state).toEqual({ status: "unknown" });
    expect(multiplayerAllowedForSession(state)).toBe(true);
  });

  // refreshJwt()'s finally has no catch, so an exception inside
  // doRefreshJwt() (here, steamSDK.getTicket() rejecting) propagates to
  // userAuth()'s top-level catch, which logs and returns false without
  // touching session state. Without retrySteamSignIn's guarantee that would
  // leave the session pinned at "retrying" forever -- gated out of
  // multiplayer with a status bar that renders no button for that state.
  it("settles to signed-out instead of sticking at retrying when doRefreshJwt throws", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getTicket").mockRejectedValue(new Error("boom"));

    await retrySteamSignIn();

    expect(getDesktopSessionState()).toEqual({
      status: "signed-out",
      reason: "steam-error",
    });
  });

  // Guards against the /auth/steam fetch hanging forever: retrySteamSignIn
  // sets "retrying" before the fetch settles, and with no AbortSignal a
  // response that never arrives would leave the session pinned there --
  // gated out of multiplayer with a status bar that renders no button for
  // "retrying". This mock fetch never settles on its own -- it only rejects
  // when the AbortSignal it was handed actually fires, the way a real fetch
  // does -- so the test can only pass if the code under test wires the
  // AbortSignal.timeout(10_000) into the request and the existing catch maps
  // the resulting abort to "network".
  //
  // AbortSignal.timeout schedules its abort on Node's internal timer, not
  // the global setTimeout that vi.useFakeTimers() patches, so it doesn't
  // advance with fake timers on its own. AbortSignal.timeout itself is
  // stubbed here to route through a (now fake) setTimeout instead, purely so
  // the 10s deadline can be crossed deterministically with
  // advanceTimersByTimeAsync rather than waiting on the wall clock.
  it("aborts and settles rather than sticking at retrying when the fetch hangs past the timeout", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
      vi.spyOn(steamSDK, "getTicket").mockResolvedValue({
        ok: true,
        ticket: "t",
      });
      vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
        const controller = new AbortController();
        setTimeout(
          () =>
            controller.abort(
              new DOMException("The operation timed out.", "TimeoutError"),
            ),
          ms,
        );
        return controller.signal;
      });
      vi.spyOn(globalThis, "fetch").mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener("abort", () => {
              reject(
                signal.reason ?? new DOMException("Aborted", "AbortError"),
              );
            });
          }),
      );

      const signInPromise = retrySteamSignIn();
      expect(getDesktopSessionState()).toEqual({ status: "retrying" });

      await vi.advanceTimersByTimeAsync(10_000);
      await signInPromise;

      expect(getDesktopSessionState()).toEqual({
        status: "signed-out",
        reason: "network",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
