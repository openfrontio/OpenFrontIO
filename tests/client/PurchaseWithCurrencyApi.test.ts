import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /shop/purchase with a `stillWanted` guard, as saveCardLoadout has: a
// purchase bound to one account is never sent under another's token, and a
// 401 for a token no longer the session's doesn't sign the session out.

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { jwtAudience: () => "localhost" },
}));
// `account` is who the session is signed in as; `switchTo` is an account a
// refresh inside getAuthHeader picks up from another tab's sign-in.
const auth = vi.hoisted(() => ({
  account: "p1",
  switchTo: null as string | null,
  logOut: vi.fn(async () => {}),
}));
vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => {
    if (auth.switchTo !== null) auth.account = auth.switchTo;
    return `Bearer ${auth.account}`;
  }),
  getPlayToken: vi.fn(async () => null),
  logOut: auth.logOut,
  userAuth: vi.fn(async () => false),
}));
vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "https://api.test",
}));

import { purchaseWithCurrency } from "../../src/client/Api";

describe("purchaseWithCurrency: stillWanted", () => {
  const fetchMock = vi.fn();
  const asP1 = () => auth.account === "p1";
  beforeEach(() => {
    auth.account = "p1";
    auth.switchTo = null;
    auth.logOut.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const buy = () =>
    purchaseWithCurrency(
      "cardBackground",
      "bg_storm_front",
      "hard",
      undefined,
      undefined,
      undefined,
      asP1,
    );

  it("still wanted: sends the purchase with that token", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await buy()).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/shop/purchase",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer p1" }),
      }),
    );
  });

  it("the account changes inside its getAuthHeader: nothing sent", async () => {
    auth.switchTo = "p2";
    expect(await buy()).toEqual({ ok: false, code: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 401 for a token no longer the session's doesn't log out", async () => {
    fetchMock.mockImplementation(async () => {
      // Another tab signs in to another account while the POST is out.
      auth.account = "p2";
      return new Response("{}", { status: 401 });
    });
    expect(await buy()).toEqual({ ok: false, code: "cancelled" });
    expect(auth.logOut).not.toHaveBeenCalled();
  });

  it("a 401 for the session's own token logs out", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await buy()).toEqual({ ok: false, code: "failed" });
    expect(auth.logOut).toHaveBeenCalledOnce();
  });
});
