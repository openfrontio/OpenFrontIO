import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COSMETICS_STALE_MS,
  fetchCosmetics,
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
});
