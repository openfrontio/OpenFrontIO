import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMapWeights } from "../../src/server/MapWeights";

// fetchMapWeights resolves its endpoint from ServerEnv.jwtIssuer(), which
// throws if DOMAIN is unset.
process.env.DOMAIN ??= "localhost";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body };
}

describe("fetchMapWeights", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the overrides, sending the API key", async () => {
    const maps = { World: { ffaFrequency: 12 }, Europe: { teamFrequency: 0 } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ maps }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchMapWeights()).toEqual(maps);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/map_weights");
    expect(init.headers["x-api-key"]).toBeDefined();
  });

  it("throws on a non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(fetchMapWeights()).rejects.toThrow("503");
  });

  it("throws on a negative weight", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ maps: { World: { ffaFrequency: -1 } } }),
        ),
    );
    await expect(fetchMapWeights()).rejects.toThrow("malformed");
  });
});
