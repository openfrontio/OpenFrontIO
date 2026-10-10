import { beforeEach, describe, expect, it, vi } from "vitest";
import { steamSDK } from "../src/client/SteamSDK";

beforeEach(() => {
  delete (window as any).openfrontDesktop;
});

describe("SteamSDK", () => {
  it("isOnSteam is false without the bridge", () => {
    expect(steamSDK.isOnSteam()).toBe(false);
  });
  it("isOnSteam true and passes through ticket/user with the bridge", async () => {
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi
          .fn()
          .mockResolvedValue({ ok: true, ticket: "deadbeef" }),
        getUser: vi.fn().mockResolvedValue({ steamId: "77", name: "Ada" }),
      },
    };
    expect(steamSDK.isOnSteam()).toBe(true);
    expect(await steamSDK.getTicket()).toEqual({
      ok: true,
      ticket: "deadbeef",
    });
    expect(await steamSDK.getUser()).toEqual({ steamId: "77", name: "Ada" });
  });
  it("getTicket degrades to a generic error when bridge rejects", async () => {
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi.fn().mockRejectedValue(new Error("boom")),
        getUser: vi.fn(),
      },
    };
    expect(await steamSDK.getTicket()).toEqual({
      ok: false,
      reason: "error",
    });
  });
  it("getUser degrades to null when bridge rejects", async () => {
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi.fn(),
        getUser: vi.fn().mockRejectedValue(new Error("boom")),
      },
    };
    expect(await steamSDK.getUser()).toBeNull();
  });

  // A shell older than this client's SteamTicketResult contract may still
  // return the legacy `string | null` shape getAuthTicket() had before. A
  // successful sign-in against that shell must not be read as a failure
  // (result.ok undefined), and null must not throw.
  it("normalises a legacy string ticket into a successful result", async () => {
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi.fn().mockResolvedValue("deadbeef"),
        getUser: vi.fn(),
      },
    };
    expect(await steamSDK.getTicket()).toEqual({
      ok: true,
      ticket: "deadbeef",
    });
  });

  it("normalises a legacy null ticket into steam-unavailable without throwing", async () => {
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi.fn().mockResolvedValue(null),
        getUser: vi.fn(),
      },
    };
    await expect(steamSDK.getTicket()).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  // A structured result is not trusted either: the shell is a separate repo,
  // so a malformed success must not reach /auth/steam as a bogus ticket.
  it.each([
    ["a missing ticket", { ok: true }],
    ["a non-string ticket", { ok: true, ticket: 1234 }],
    ["an empty ticket", { ok: true, ticket: "" }],
  ])("rejects a malformed success object with %s", async (_label, shape) => {
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi.fn().mockResolvedValue(shape),
        getUser: vi.fn(),
      },
    };
    expect(await steamSDK.getTicket()).toEqual({ ok: false, reason: "error" });
  });

  // The IPC call itself has no bound otherwise: a hung shell would leave
  // getTicket() (and everything downstream of it) waiting forever, which is
  // the same "retrying" lockout the /auth/steam AbortSignal.timeout guards
  // against. The bridge promise below never settles on its own.
  it("times out rather than hanging when the bridge never settles", async () => {
    vi.useFakeTimers();
    try {
      (window as any).openfrontDesktop = {
        steam: {
          getAuthTicket: vi.fn().mockReturnValue(new Promise(() => {})),
          getUser: vi.fn(),
        },
      };
      const ticketPromise = steamSDK.getTicket();
      await vi.advanceTimersByTimeAsync(8000);
      await expect(ticketPromise).resolves.toEqual({
        ok: false,
        reason: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
