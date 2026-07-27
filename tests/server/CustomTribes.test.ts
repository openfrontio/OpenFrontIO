import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCustomTribes } from "../../src/server/CustomTribes";

// fetchCustomTribes resolves its endpoint from ServerEnv.jwtIssuer(), which
// throws if DOMAIN is unset.
process.env.DOMAIN ??= "localhost";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body };
}

describe("fetchCustomTribes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the lobby players and returns the tribe names", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        tribes: [{ name: "Dragon Riders" }, { name: "Night Wolves" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const players = [{ clientId: "abcd1234", publicId: "pub-1" }];
    expect(await fetchCustomTribes(players)).toEqual([
      "Dragon Riders",
      "Night Wolves",
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/custom_tribes");
    expect(init.headers["x-api-key"]).toBeDefined();
    expect(JSON.parse(init.body)).toEqual({ players });
  });

  it("strips extra per-tribe fields the API sends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          tribes: [{ name: "Dragon Riders", futureField: "ignored" }],
        }),
      ),
    );
    expect(await fetchCustomTribes([])).toEqual(["Dragon Riders"]);
  });

  it("returns an empty pool for an empty lobby", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ tribes: [] })),
    );
    expect(await fetchCustomTribes([])).toEqual([]);
  });

  it("caps the posted players at 500", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tribes: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const players = Array.from({ length: 501 }, (_, i) => ({
      clientId: `client_${i}`,
      publicId: `pub_${i}`,
    }));
    await fetchCustomTribes(players);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).players).toHaveLength(500);
  });

  it("throws on a non-200 so the caller fails open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(fetchCustomTribes([])).rejects.toThrow(
      "custom_tribes returned 500",
    );
  });

  it("throws on a malformed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ tribes: "nope" })),
    );
    await expect(fetchCustomTribes([])).rejects.toThrow("malformed");
  });

  it("throws on a tribe that fails validation", async () => {
    const badTribe = { name: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ tribes: [badTribe] })),
    );
    await expect(fetchCustomTribes([])).rejects.toThrow("malformed");
  });

  it("propagates network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
    );
    await expect(fetchCustomTribes([])).rejects.toThrow("ECONNREFUSED");
  });
});
