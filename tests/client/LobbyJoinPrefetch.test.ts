import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real implementations but replace getApiBase so fetches go nowhere.
vi.mock("src/client/Api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/Api")>();
  return { ...actual, getApiBase: vi.fn(() => "http://test-api") };
});

vi.mock("src/core/AssetUrls", () => ({
  assetUrl: vi.fn((p: string) => p),
}));

vi.mock("src/client/Auth", () => ({
  userAuth: vi.fn(async () => ({ jwt: "test-jwt", claims: {} })),
  getAuthHeader: vi.fn(async () => "Bearer test-jwt"),
  logOut: vi.fn(),
}));

const emptyCosmetics = {
  patterns: {},
  flags: {},
  subscriptions: {},
  skins: {},
};

// ---------------------------------------------------------------------------
// fetchCosmetics — module-level deduplication
// ---------------------------------------------------------------------------

describe("fetchCosmetics caching", () => {
  let fetchCosmetics: () => Promise<unknown>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => emptyCosmetics })),
    );
    const mod = await import("../../src/client/Cosmetics");
    fetchCosmetics = mod.fetchCosmetics;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes exactly one network request even when called concurrently", async () => {
    await Promise.all([fetchCosmetics(), fetchCosmetics(), fetchCosmetics()]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("makes exactly one network request on sequential calls", async () => {
    await fetchCosmetics();
    await fetchCosmetics();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns the same resolved value on every call", async () => {
    const [r1, r2, r3] = await Promise.all([
      fetchCosmetics(),
      fetchCosmetics(),
      fetchCosmetics(),
    ]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it("returns null and does not throw on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    vi.resetModules();
    const mod = await import("../../src/client/Cosmetics");
    const result = await mod.fetchCosmetics();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getUserMe — deduplication and caching
// ---------------------------------------------------------------------------

const userMePayload = {
  user: { discord: null, email: "test@example.com" },
  player: { flares: [], friends: [], publicId: "pub-1" },
};

describe("getUserMe caching", () => {
  let getUserMe: () => Promise<unknown>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => userMePayload,
      })),
    );
    const mod = await import("../../src/client/Api");
    getUserMe = mod.getUserMe;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes exactly one network request even when called concurrently", async () => {
    await Promise.all([getUserMe(), getUserMe(), getUserMe()]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns the same object reference on sequential calls (cache hit)", async () => {
    const r1 = await getUserMe();
    const r2 = await getUserMe();
    expect(r1).toBe(r2);
  });

  it("returns false when userAuth returns false", async () => {
    vi.resetModules();
    vi.mocked((await import("src/client/Auth")).userAuth).mockResolvedValueOnce(
      false as any,
    );
    const mod = await import("../../src/client/Api");
    const result = await mod.getUserMe();
    expect(result).toBe(false);
  });
});
