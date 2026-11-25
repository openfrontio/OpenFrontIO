import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { jwtAudience: () => "localhost" },
}));

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => ""),
  getPlayToken: vi.fn(async () => null),
  logOut: vi.fn(async () => {}),
  isSessionActive: vi.fn(() => true),
  isOtherSession: vi.fn(() => false),
  rememberPublicId: vi.fn(),
  userAuth: vi.fn(async () => ({
    jwt: "test-jwt",
    claims: { sub: "player-1" },
  })),
}));

import {
  fetchUserMeUncached,
  getUserMe,
  invalidateUserMe,
} from "../../src/client/Api";
import {
  isOtherSession,
  isSessionActive,
  logOut,
  userAuth,
} from "../../src/client/Auth";

// The bound the rest of the authenticated surface already uses.
const AUTH_FETCH_TIMEOUT_MS = 10_000;

const profile = {
  user: {},
  steamLicence: false,
  steamLicenceSince: null,
  noticesSeen: [],
  pendingMessages: [],
  player: {
    publicId: "player-1",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    flares: [],
    achievements: { player: [], singleplayerMap: [] },
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

// A caller that wants the profile as it is now (the provisional XP figure at
// death) must not lose everyone else's good copy to a failed request.
describe("fetchUserMeUncached", () => {
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

  const userMeCalls = () =>
    fetchMock.mock.calls.filter((c) => String(c[0]).includes("/users/@me"));

  it("asks afresh each time, leaving the cached profile alone", async () => {
    expect(await getUserMe()).toEqual(profile);
    expect(await fetchUserMeUncached()).toEqual(profile);
    expect(await fetchUserMeUncached()).toEqual(profile);
    expect(userMeCalls()).toHaveLength(3);
    // Still the cached copy: no further request.
    expect(await getUserMe()).toEqual(profile);
    expect(userMeCalls()).toHaveLength(3);
  });

  it("never caches a failure in place of a good profile", async () => {
    expect(await getUserMe()).toEqual(profile);
    fetchMock.mockResolvedValueOnce({ status: 500, json: async () => ({}) });
    expect(await fetchUserMeUncached()).toBe(false);
    expect(await getUserMe()).toEqual(profile);
  });

  it("caches nothing when there was no copy yet", async () => {
    fetchMock.mockResolvedValueOnce({ status: 500, json: async () => ({}) });
    expect(await fetchUserMeUncached()).toBe(false);
    expect(await getUserMe()).toEqual(profile);
    expect(userMeCalls()).toHaveLength(2);
  });
});

// requestUserMe answers a 401 by calling logOut(), and logOut() POSTs
// /auth/logout with credentials — which revokes whatever refresh cookie is
// live at that moment, not the one the request was issued with. A player who
// signs out and back in while a /users/@me is in flight would have the stale
// request's 401 — a fact about the session that is already dead — revoke the
// session that replaced it. The caller cannot defend against it: logOut()
// runs inside requestUserMe, before the answer is ever returned.
describe("a 401 only ends the session that asked for it", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invalidateUserMe();
    fetchMock = vi.fn(async () => ({ status: 401, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(logOut).mockClear();
    vi.mocked(isSessionActive).mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    // Restore the module mock's default for the rest of the file.
    vi.mocked(isSessionActive).mockReturnValue(true);
    invalidateUserMe();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ignores a 401 for a session that is no longer the current one", async () => {
    vi.mocked(isSessionActive).mockReturnValue(false);

    expect(await getUserMe()).toBe(false);

    expect(logOut).not.toHaveBeenCalled();
    // Against the session that issued the request, not whatever is current.
    expect(isSessionActive).toHaveBeenCalledWith("player-1");
  });

  // The other direction, and the reason this is a guard rather than a
  // deletion: a 401 for the session that IS still current is a genuine
  // conclusion about that session, and it must still end it.
  it("ends the session when the 401 is for the still-current one", async () => {
    vi.mocked(isSessionActive).mockReturnValue(true);

    expect(await getUserMe()).toBe(false);

    expect(logOut).toHaveBeenCalledTimes(1);
  });
});

// A profile fetched with one session's token describes that session's
// account. If the session is gone by the time it lands (signed out, or a
// portal switch to another account), caching it would answer the next
// session's getUserMe() with the old account.
describe("/users/@me from a session that has gone", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const meCalls = () =>
    fetchMock.mock.calls.filter((c) => String(c[0]).includes("/users/@me"));

  beforeEach(() => {
    invalidateUserMe();
    fetchMock = vi.fn(async () => ({ status: 200, json: async () => profile }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(isSessionActive).mockReturnValue(true);
    vi.mocked(isOtherSession).mockReturnValue(false);
    invalidateUserMe();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("isn't cached: the next caller asks again", async () => {
    vi.mocked(isSessionActive).mockReturnValue(false);
    // Its own caller still gets what it fetched.
    expect(await getUserMe()).toEqual(profile);
    vi.mocked(isSessionActive).mockReturnValue(true);
    await getUserMe();
    expect(meCalls()).toHaveLength(2);
  });

  it("nor is a failure it got (a 401 for the old token)", async () => {
    vi.mocked(isSessionActive).mockReturnValue(false);
    fetchMock.mockResolvedValueOnce({ status: 401, json: async () => ({}) });
    expect(await getUserMe()).toBe(false);
    vi.mocked(isSessionActive).mockReturnValue(true);
    expect(await getUserMe()).toEqual(profile);
    expect(meCalls()).toHaveLength(2);
  });

  it("one for the session still current is cached as before", async () => {
    await getUserMe();
    await getUserMe();
    expect(meCalls()).toHaveLength(1);
  });

  it("nor is one whose body couldn't be read after the session went", async () => {
    // 200 headers for the old session, then the body read fails.
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => {
        vi.mocked(isSessionActive).mockReturnValue(false);
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });
    expect(await getUserMe()).toBe(false);
    vi.mocked(isSessionActive).mockReturnValue(true);
    expect(await getUserMe()).toEqual(profile);
    expect(meCalls()).toHaveLength(2);
  });

  it("a cached profile isn't reused once the session is another account's", async () => {
    // Cached for player-1's session...
    expect(await getUserMe()).toEqual(profile);
    // ...then a silent token refresh installs another account, with no
    // session event to clear the cache.
    vi.mocked(isSessionActive).mockImplementation(
      (sub: string) => sub !== "player-1",
    );
    vi.mocked(isOtherSession).mockImplementation(
      (sub: string) => sub === "player-1",
    );
    await getUserMe();
    expect(meCalls()).toHaveLength(2);
    vi.mocked(isOtherSession).mockReturnValue(false);
  });

  it("a request still in flight isn't joined once the session is another account's", async () => {
    let answer!: (v: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (answer = r)));
    // A's request has its token and is waiting on the network...
    const first = getUserMe();
    await vi.waitFor(() => expect(meCalls()).toHaveLength(1));
    // ...when a silent refresh installs B.
    vi.mocked(isOtherSession).mockImplementation(
      (sub: string) => sub === "player-1",
    );
    const second = getUserMe();
    // B's caller doesn't wait on A's request: it asks again.
    expect(meCalls()).toHaveLength(1);
    await vi.waitFor(() => expect(meCalls()).toHaveLength(2));
    answer({ status: 200, json: async () => profile });
    // A's caller still gets its own answer.
    expect(await first).toEqual(profile);
    await second;
    vi.mocked(isOtherSession).mockReturnValue(false);
  });

  it("a brief refresh outage keeps the cached profile, and never caches signed out", async () => {
    expect(await getUserMe()).toEqual(profile);
    // /auth/refresh answers 5xx: no token for now (isSessionActive is false
    // for every subject), but no other account either.
    vi.mocked(isSessionActive).mockReturnValue(false);
    vi.mocked(userAuth).mockResolvedValueOnce(false as never);
    expect(await getUserMe()).toEqual(profile);
    // Recovered.
    vi.mocked(isSessionActive).mockReturnValue(true);
    expect(await getUserMe()).toEqual(profile);
    expect(meCalls()).toHaveLength(1);
  });
});
