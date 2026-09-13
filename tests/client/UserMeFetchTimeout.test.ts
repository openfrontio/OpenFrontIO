import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { jwtAudience: () => "localhost" },
}));

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => ""),
  getPlayToken: vi.fn(async () => null),
  logOut: vi.fn(async () => {}),
  isSessionActive: vi.fn(() => false),
  userAuth: vi.fn(async () => ({
    jwt: "test-jwt",
    claims: { sub: "player-1" },
  })),
}));

import { getUserMe, invalidateUserMe } from "../../src/client/Api";

// The bound the rest of the authenticated surface already uses.
const AUTH_FETCH_TIMEOUT_MS = 10_000;

const profile = {
  user: {},
  player: {
    publicId: "player-1",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    flares: [],
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
  },
};

// The rejection AbortSignal.timeout produces once the deadline passes, raised
// directly so the test does not burn ten real seconds reaching it.
function abortError(): Error {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return error;
}

// getUserMe memoises the in-flight promise and never clears it on the way
// out, so a /users/@me that never settles is not one slow call: it pins
// __userMe on a forever-pending promise, and every later getUserMe() in the
// session — cosmetics, store, inventory, the multiplayer join path — awaits
// that same promise. This is what made a stalled connection able to hang a
// single-player start even after fetchCosmetics itself was bounded.
describe("/users/@me is bounded", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invalidateUserMe();
    fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => profile,
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    invalidateUserMe();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hands the profile request a deadline-bound signal", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await getUserMe();

    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/users/@me"),
    );
    expect(call).toBeDefined();
    const init = call![1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(AUTH_FETCH_TIMEOUT_MS);
  });

  // The bound is only safe if the failure it produces is not permanent. A
  // deadline we imposed ourselves concluded nothing about the account, so
  // leaving it memoised would strand a merely-slow connection as "signed out"
  // for the rest of the session — no player-scoped settings, no cosmetics, no
  // verified badge, recoverable only by reloading.
  it("does not cache a timeout, so the next caller retries", async () => {
    fetchMock.mockRejectedValueOnce(abortError());

    expect(await getUserMe()).toBe(false);
    expect(await getUserMe()).toEqual(profile);

    const calls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/users/@me"),
    );
    expect(calls).toHaveLength(2);
  });

  // The other half, and the reason this is not a blanket un-cache: a 401 is a
  // conclusion about the account. Re-deriving those would put an
  // /auth/refresh behind every getUserMe() call for every logged-out player.
  it("remembers a 401 rather than retrying it", async () => {
    fetchMock.mockResolvedValueOnce({ status: 401, json: async () => ({}) });

    expect(await getUserMe()).toBe(false);
    expect(await getUserMe()).toBe(false);

    const calls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/users/@me"),
    );
    expect(calls).toHaveLength(1);
  });

  it("remembers a server error rather than retrying it", async () => {
    fetchMock.mockResolvedValueOnce({ status: 500, json: async () => ({}) });

    expect(await getUserMe()).toBe(false);
    expect(await getUserMe()).toBe(false);

    const calls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/users/@me"),
    );
    expect(calls).toHaveLength(1);
  });
});
