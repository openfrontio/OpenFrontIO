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

import {
  saveCardLoadout,
  saveTauntsMuted,
} from "../../src/client/CardLoadoutApi";

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
    // So the Account header, a recreated My Card tab and any other editor
    // read the saved card, not the copy from when the modal opened.
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

  it("network failure", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await saveCardLoadout(LOADOUT)).toEqual({
      ok: false,
      error: "failed",
    });
  });
});

describe("saveTauntsMuted", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves the setting", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ muted: true }), { status: 200 }),
    );
    expect(await saveTauntsMuted(true)).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      muted: true,
    });
  });

  it("failure gives false", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    expect(await saveTauntsMuted(true)).toBe(false);
  });
});
