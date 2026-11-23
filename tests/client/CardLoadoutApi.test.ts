import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ logOut: vi.fn(async () => true) }));
vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: async () => "Bearer t",
  logOut: auth.logOut,
}));
vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "https://api.test",
}));
const userMe = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("../../src/client/Api", () => ({
  invalidateUserMe: userMe.invalidate,
}));
const fresh = vi.hoisted(() => ({ broadcast: vi.fn(async () => false) }));
vi.mock("../../src/client/Cosmetics", () => ({
  broadcastFreshUserMe: fresh.broadcast,
}));

import { saveCardLoadout } from "../../src/client/CardLoadoutApi";

const LOADOUT = {
  background: "bg_pacific",
  title: null,
  taunt: null,
  trackers: ["wins" as const],
};

describe("saveCardLoadout", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    userMe.invalidate.mockReset();
    fresh.broadcast.mockReset();
    fresh.broadcast.mockResolvedValue(false);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("broadcasts a fresh /users/@me before a successful save returns", async () => {
    // So the Account header and the Inventory's card editor read the saved
    // card, not the copy from when the modal opened.
    let broadcastDone = false;
    fresh.broadcast.mockImplementation(async () => {
      await Promise.resolve();
      broadcastDone = true;
      return false;
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(LOADOUT), { status: 200 }),
    );
    await saveCardLoadout(LOADOUT);
    expect(fresh.broadcast).toHaveBeenCalledTimes(1);
    expect(broadcastDone).toBe(true);
  });

  it("a failed refresh doesn't fail the save", async () => {
    fresh.broadcast.mockRejectedValue(new Error("offline"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(LOADOUT), { status: 200 }),
    );
    expect(await saveCardLoadout(LOADOUT)).toEqual({
      ok: true,
      loadout: LOADOUT,
    });
  });

  it("a failed save broadcasts nothing", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await saveCardLoadout(LOADOUT);
    expect(fresh.broadcast).not.toHaveBeenCalled();
  });

  it("sends nothing when no longer wanted once the token is read", async () => {
    // Reading the token can wait on a JWT refresh; a sign-out meanwhile
    // must not send this loadout under the next session's token.
    expect(await saveCardLoadout(LOADOUT, () => false)).toEqual({
      ok: false,
      error: "cancelled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fresh.broadcast).not.toHaveBeenCalled();
  });

  it("PUTs the loadout and returns what was stored", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(LOADOUT), { status: 200 }),
    );
    expect(await saveCardLoadout(LOADOUT)).toEqual({
      ok: true,
      loadout: LOADOUT,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/users/@me/card");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual(LOADOUT);
  });

  it("403 not_owned names the slot", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "not_owned", slot: "trackers" }), {
        status: 403,
      }),
    );
    expect(await saveCardLoadout(LOADOUT)).toEqual({
      ok: false,
      error: "not_owned",
      slot: "trackers",
    });
  });

  it("403 no_card", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "no_card" }), { status: 403 }),
    );
    expect(await saveCardLoadout(LOADOUT)).toEqual({
      ok: false,
      error: "no_card",
    });
  });

  it("401 logs out", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    expect(await saveCardLoadout(LOADOUT)).toEqual({
      ok: false,
      error: "logged_out",
    });
    expect(auth.logOut).toHaveBeenCalled();
  });

  it("a 401 for a save no longer wanted doesn't sign the new session out", async () => {
    // Signed out and back in (or into another account) while the PUT was
    // out: the 401 is about the old token.
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    auth.logOut.mockClear();
    // Wanted when the token was read, not by the time the 401 came back.
    let asked = 0;
    const result = await saveCardLoadout(LOADOUT, () => ++asked === 1);
    expect(fetchMock).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "cancelled" });
    expect(auth.logOut).not.toHaveBeenCalled();
  });

  it("network failure", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await saveCardLoadout(LOADOUT)).toEqual({
      ok: false,
      error: "failed",
    });
  });
});
