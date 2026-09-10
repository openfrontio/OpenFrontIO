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
      status: 500,
      json: async () => ({}),
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
});
