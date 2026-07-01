import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getUserMe()/getAuthHeader() resolve auth via ./Auth. Mock it so we can drive
// the token + outcome bookkeeping deterministically and observe what Api records.
const { userAuthMock, markAuthOutcomeMock, getAuthHeaderMock } = vi.hoisted(
  () => ({
    userAuthMock: vi.fn(),
    markAuthOutcomeMock: vi.fn(),
    getAuthHeaderMock: vi.fn(),
  }),
);

vi.mock("../../src/client/Auth", () => ({
  userAuth: userAuthMock,
  getAuthHeader: getAuthHeaderMock,
  markAuthOutcome: markAuthOutcomeMock,
  LINKED_ACCOUNT_KEY: "was_linked_account",
}));

import {
  cancelSubscription,
  getUserMe,
  invalidateUserMe,
  wasLinkedAccount,
} from "../../src/client/Api";

const LINKED_ACCOUNT_KEY = "was_linked_account";

function userMeBody(linked: boolean) {
  return {
    user: linked ? { email: "player@example.com" } : {},
    player: {
      publicId: "public-123",
      adfree: false,
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
    },
  };
}

const okJson = (data: unknown) => ({
  status: 200,
  ok: true,
  json: async () => data,
});

describe("Api.getUserMe: transient handling and caching", () => {
  beforeEach(() => {
    localStorage.clear();
    invalidateUserMe();
    userAuthMock.mockReset();
    markAuthOutcomeMock.mockReset();
    getAuthHeaderMock.mockReset();
    getAuthHeaderMock.mockResolvedValue("Bearer test-token");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not cache a transient /users/@me failure, so a retry can recover", async () => {
    userAuthMock.mockResolvedValue({ jwt: "jwt-1", claims: {} });
    let meCalls = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/users/@me")) {
        meCalls++;
        if (meCalls === 1) {
          return { status: 503, ok: false, json: async () => ({}) };
        }
        return okJson(userMeBody(true));
      }
      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await getUserMe();
    expect(first).toBe(false);
    expect(markAuthOutcomeMock).toHaveBeenCalledWith("transient");

    // The `false` was NOT memoized: a second call re-hits the server and the
    // now-recovered backend succeeds.
    const second = await getUserMe();
    expect(second).not.toBe(false);
    expect(meCalls).toBe(2);
  });

  it("on success records linked status (persisted) and an 'ok' outcome", async () => {
    userAuthMock.mockResolvedValue({ jwt: "jwt-1", claims: {} });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/users/@me")
          ? okJson(userMeBody(true))
          : okJson({}),
      ),
    );

    const me = await getUserMe();
    expect(me).not.toBe(false);
    expect(localStorage.getItem(LINKED_ACCOUNT_KEY)).toBe("true");
    expect(wasLinkedAccount()).toBe(true);
    expect(markAuthOutcomeMock).toHaveBeenLastCalledWith("ok");
  });

  it("remembers a guest (no linked account) as not-linked", async () => {
    userAuthMock.mockResolvedValue({ jwt: "jwt-1", claims: {} });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/users/@me")
          ? okJson(userMeBody(false))
          : okJson({}),
      ),
    );

    await getUserMe();
    expect(localStorage.getItem(LINKED_ACCOUNT_KEY)).toBe("false");
    expect(wasLinkedAccount()).toBe(false);
  });
});

describe("Api: authenticated endpoints don't destroy the session on a 401", () => {
  beforeEach(() => {
    localStorage.clear();
    invalidateUserMe();
    getAuthHeaderMock.mockReset();
    getAuthHeaderMock.mockResolvedValue("Bearer test-token");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("cancelSubscription returns false on 401 without calling /auth/logout", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => ({
      status: 401,
      ok: false,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await cancelSubscription();
    expect(result).toBe(false);
    // A spurious 401 must not revoke the session.
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("/auth/logout")),
    ).toBe(false);
  });
});
