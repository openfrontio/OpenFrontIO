import * as streamWeb from "node:stream/web";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-jwt"),
}));

vi.mock("../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "https://api.test"),
}));

import {
  deleteSavedGame,
  downloadSavedGame,
  gunzip,
  gzip,
  listSavedGames,
  updateSavedGame,
  uploadSavedGame,
} from "../../src/client/SavedGamesApi";

const SAVE = {
  id: "abcdefghijklmnopqrstuv",
  name: "World 2026-10-19 14:05",
  map: "World",
  tick: 1200,
  sizeBytes: 321,
  public: false,
  createdAt: "2026-10-19T14:05:00.000Z",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SavedGamesApi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom's streams aren't Node's; the compression streams need Node's.
    vi.stubGlobal("ReadableStream", streamWeb.ReadableStream);
    vi.stubGlobal("CompressionStream", streamWeb.CompressionStream);
    vi.stubGlobal("DecompressionStream", streamWeb.DecompressionStream);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gzips and gunzips a snapshot unchanged", async () => {
    const bytes = new Uint8Array(10_000).map((_, i) => i % 7);
    const zipped = await gzip(bytes);
    expect(new Uint8Array(gunzipSync(zipped))).toEqual(bytes);
    expect(await gunzip(zipped)).toEqual(bytes);
  });

  it("refuses to inflate past the cap (a shared save can be a gzip bomb)", async () => {
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(1_000_000)));
    await expect(gunzip(bomb, 100_000)).rejects.toThrow("too large");
  });

  it("uploads the snapshot gzipped, with its details in the query", async () => {
    fetchMock.mockResolvedValue(json(SAVE, 201));
    const snapshot = new Uint8Array([5, 4, 3, 2, 1]);

    const result = await uploadSavedGame(snapshot, {
      name: SAVE.name,
      map: "Gulf of St. Lawrence",
      tick: 1200,
    });

    expect(result).toEqual(SAVE);
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://api.test/users/@me/saved_games",
    );
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      name: SAVE.name,
      map: "Gulf of St. Lawrence",
      tick: "1200",
    });
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
    // A byte body, so the browser sends the Content-Length the API checks.
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect(new Uint8Array(gunzipSync(init.body))).toEqual(snapshot);
  });

  it.each([
    [409, "limit"],
    [401, "unauthorized"],
    [400, "rejected"],
    [500, "request_failed"],
  ])("maps an upload's %i to %s", async (status, error) => {
    fetchMock.mockResolvedValue(json({ reason: "no" }, status));
    await expect(
      uploadSavedGame(new Uint8Array([1]), {
        name: "a",
        map: "World",
        tick: 0,
      }),
    ).resolves.toBe(error);
  });

  it("downloads a shared save from the public route, without a session", async () => {
    const snapshot = new Uint8Array([9, 8, 7]);
    fetchMock.mockResolvedValue(new Response(gzipSync(snapshot)));

    await expect(downloadSavedGame(SAVE.id, true)).resolves.toEqual(snapshot);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.test/public/saved_games/${SAVE.id}/data`);
    expect(init?.headers?.Authorization).toBeUndefined();
  });

  it("downloads the player's own save with their session", async () => {
    const snapshot = new Uint8Array([1, 1, 2, 3]);
    fetchMock.mockResolvedValue(new Response(gzipSync(snapshot)));

    await expect(downloadSavedGame(SAVE.id, false)).resolves.toEqual(snapshot);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.test/users/@me/saved_games/${SAVE.id}/data`);
    expect(init.headers.Authorization).toBe("Bearer test-jwt");
  });

  it("reports a missing save as not_found", async () => {
    fetchMock.mockResolvedValue(json({ reason: "Unknown saved game" }, 404));
    await expect(downloadSavedGame(SAVE.id, true)).resolves.toBe("not_found");
  });

  it("shares a save with a JSON PATCH, and reports a refused name", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...SAVE, public: true }));
    await expect(updateSavedGame(SAVE.id, { public: true })).resolves.toEqual({
      ...SAVE,
      public: true,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.test/users/@me/saved_games/${SAVE.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ public: true });

    fetchMock.mockResolvedValueOnce(json({ reason: "not allowed" }, 400));
    await expect(updateSavedGame(SAVE.id, { public: true })).resolves.toBe(
      "rejected",
    );
  });

  it("deletes a save", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteSavedGame(SAVE.id)).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("lists the player's saves, and fails closed on a bad answer", async () => {
    fetchMock.mockResolvedValueOnce(json({ savedGames: [SAVE] }));
    await expect(listSavedGames()).resolves.toEqual([SAVE]);

    fetchMock.mockResolvedValueOnce(json({ savedGames: "nope" }));
    await expect(listSavedGames()).resolves.toBe(false);
  });
});
