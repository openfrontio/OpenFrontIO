import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COSMETICS_STALE_MS,
  cosmeticsCacheIsStale,
  fetchCosmetics,
  getCachedCosmetics,
  invalidateCosmetics,
  refreshStaleCosmetics,
} from "../../src/client/Cosmetics";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getApiBase: () => "https://api.test",
}));

// Sale prices start and end on the server, so the store refetches a catalog
// older than COSMETICS_STALE_MS when it opens.
describe("refreshStaleCosmetics", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invalidateCosmetics();
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ patterns: {}, flags: {} }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    invalidateCosmetics();
    vi.unstubAllGlobals();
  });

  it("keeps a fresh catalog", async () => {
    await fetchCosmetics();
    expect(refreshStaleCosmetics(Date.now() + COSMETICS_STALE_MS - 1000)).toBe(
      false,
    );
    await fetchCosmetics();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches a catalog older than the stale window", async () => {
    await fetchCosmetics();
    expect(refreshStaleCosmetics(Date.now() + COSMETICS_STALE_MS + 1000)).toBe(
      true,
    );
    await fetchCosmetics();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the newer catalog when an older fetch lands last", async () => {
    const body = { patterns: {}, flags: {} };
    let resolveOlder: (body: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: () => new Promise((r) => (resolveOlder = r)),
    }));
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    }));
    const first = fetchCosmetics();
    invalidateCosmetics();
    const newer = await fetchCosmetics();
    expect(newer).not.toBeNull();
    expect(getCachedCosmetics()).toBe(newer);

    resolveOlder(body);
    // The older caller still gets its answer, but the cache keeps the newer.
    const older = await first;
    expect(older).not.toBeNull();
    expect(older).not.toBe(newer);
    expect(getCachedCosmetics()).toBe(newer);
    expect(cosmeticsCacheIsStale()).toBe(false);
  });
});
