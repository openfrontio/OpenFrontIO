import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserMe } from "../../src/client/Api";
import {
  COSMETICS_FETCH_TIMEOUT_MS,
  fetchCosmetics,
  invalidateCosmetics,
  prewarmCosmetics,
} from "../../src/client/Cosmetics";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  // Resolving the real API base needs the runtime config these tests don't
  // boot; the URL is not what is under test.
  getApiBase: () => "https://api.test",
  getUserMe: vi.fn(),
}));

// Minimal catalog: everything except patterns and flags is optional, and
// nothing here cares what is in it.
const catalog = { patterns: {}, flags: {} };

function okResponse() {
  return { ok: true, status: 200, json: async () => catalog };
}

// The rejection AbortSignal.timeout produces once the deadline passes. Raised
// here directly so the test does not have to burn ten real seconds proving
// what happens after it.
function abortError(): Error {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return error;
}

describe("fetchCosmetics is bounded", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invalidateCosmetics();
    vi.mocked(getUserMe).mockResolvedValue(false);
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    invalidateCosmetics();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // The defect this pins: the catalog request used to carry no signal at all,
  // so a connection that stalled rather than being refused (Steam offline
  // mode, a captive portal, a dead DNS server) never came back, and every
  // caller waiting on it — including the game-start path — waited forever.
  it("hands fetch a deadline-bound signal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await fetchCosmetics();

    expect(timeoutSpy).toHaveBeenCalledWith(COSMETICS_FETCH_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.signal).toBe(timeoutSpy.mock.results[0].value);
  });

  it("bounds the catalog no later than the auth calls bound themselves", () => {
    // Auth.ts and Api.ts both use AbortSignal.timeout(10_000). A looser bound
    // here would put the slowest wait back on the game-start path.
    expect(COSMETICS_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(COSMETICS_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("resolves to null on the timeout rather than rejecting", async () => {
    fetchMock.mockRejectedValueOnce(abortError());

    // Callers treat a null catalog as "no cosmetics info", not as an error;
    // a rejection here would propagate into the game-start path instead.
    await expect(fetchCosmetics()).resolves.toBeNull();
  });

  it("does not cache the timeout, so the next caller retries", async () => {
    fetchMock.mockRejectedValueOnce(abortError());

    expect(await fetchCosmetics()).toBeNull();
    expect(await fetchCosmetics()).toEqual(catalog);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("prewarmCosmetics", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invalidateCosmetics();
    vi.mocked(getUserMe).mockResolvedValue(false);
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    invalidateCosmetics();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // The point of the prewarm: the round trip is spent while the player is
  // still choosing a map, so the resolution that runs when they finally click
  // Start answers from memory and issues no request of its own.
  it("warms the catalog so a later resolution issues no request", async () => {
    await prewarmCosmetics();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await fetchCosmetics()).toEqual(catalog);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("warms the profile the same resolution reads", async () => {
    await prewarmCosmetics();
    expect(vi.mocked(getUserMe)).toHaveBeenCalled();
  });

  // Callers fire and forget it, so a rejection would surface as an unhandled
  // promise rejection rather than anywhere it could be handled.
  it("never rejects", async () => {
    fetchMock.mockRejectedValueOnce(abortError());
    vi.mocked(getUserMe).mockRejectedValueOnce(new Error("offline"));

    await expect(prewarmCosmetics()).resolves.toBeUndefined();
  });
});
