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

  it("returns the weights, sending the API key", async () => {
    const maps = {
      World: { ffaWeight: 30, teamWeight: 5.23, specialWeight: 30 },
      Europe: { teamWeight: 0 },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ maps }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchMapWeights()).toEqual(maps);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/map_weights");
    expect(init.headers["x-api-key"]).toBeDefined();
  });

  it("ignores the legacy frequency fields", async () => {
    const maps = { World: { ffaFrequency: 12, ffaWeight: 12 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ maps })));
    expect(await fetchMapWeights()).toEqual({ World: { ffaWeight: 12 } });
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
          jsonResponse({ maps: { World: { ffaWeight: -1 } } }),
        ),
    );
    await expect(fetchMapWeights()).rejects.toThrow("malformed");
  });
});
