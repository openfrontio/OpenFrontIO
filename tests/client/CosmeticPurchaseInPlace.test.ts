import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The end screen buys without reloading (a reload would end the player's
// game): ownership and balances refresh in place instead. The Store and
// Inventory keep their reload. In client-forks: it stubs window.location.

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
  purchaseWithCurrency: vi.fn(),
}));
// `real` hands the call to the real userAuth, with fetch stubbed, so a
// refresh's answer goes through Auth.ts's own handling. Otherwise, like the
// real one, a token expired or within 3 minutes of expiry is refreshed only
// when asked to (shouldRefresh, the default).
// `publicId` is the account currentPublicId() reports.
const auth = vi.hoisted(() => ({
  session: true,
  real: false,
  expired: false,
  publicId: "p1" as string | null,
}));
vi.mock("../../src/client/Auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/client/Auth")>();
  return {
    ...real,
    currentPublicId: vi.fn(() =>
      auth.real ? real.currentPublicId() : auth.publicId,
    ),
    userAuth: vi.fn(async (shouldRefresh = true) => {
      if (auth.real) return real.userAuth(shouldRefresh);
      if (!auth.session) return false;
      if (auth.expired) {
        if (!shouldRefresh) return false;
        auth.expired = false; // refreshed from the refresh cookie
      }
      return { jwt: "j", claims: {} };
    }),
  };
});
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn().mockResolvedValue(true),
  showInGameConfirm: vi.fn().mockResolvedValue(true),
}));

const { getUserMe, purchaseWithCurrency } =
  await import("../../src/client/Api");
const { showInGameAlert } = await import("../../src/client/InGameModal");
const { checkInPlacePurchase, purchaseCosmetic, purchaseCosmeticInPlace } =
  await import("../../src/client/Cosmetics");
const { invalidateUserMe } = await import("../../src/client/Api");
const { translateText } = await import("../../src/client/Utils");
const { clearPendingPurchase, peekPendingPurchase, rememberPendingPurchase } =
  await import("../../src/client/components/inventory/PendingEquip");

const STORM = {
  type: "cardBackground",
  cosmetic: {
    name: "bg_storm_front",
    priceHard: 320,
    priceSoft: 2000,
    rarity: "legendary",
  },
  colorPalette: null,
  relationship: "purchasable",
  key: "cardBackground:bg_storm_front",
} as never;

const me = (hard: number, soft: number, flares: string[] = []) =>
  ({
    player: { publicId: "p1", flares, currency: { hard, soft } },
  }) as never;

describe("buying on the end screen", () => {
  let reload: ReturnType<typeof vi.fn>;
  let broadcasts: unknown[];
  const original = window.location;
  const onUserMe = (e: Event) => broadcasts.push((e as CustomEvent).detail);

  beforeEach(() => {
    reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });
    broadcasts = [];
    document.addEventListener("userMeResponse", onUserMe);
    vi.mocked(getUserMe).mockReset();
    vi.mocked(purchaseWithCurrency).mockReset();
    vi.mocked(showInGameAlert).mockClear();
  });
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: original,
    });
    document.removeEventListener("userMeResponse", onUserMe);
    clearPendingPurchase();
    auth.expired = false;
    auth.publicId = "p1";
  });

  it("a success refreshes in place: no reload, the fresh profile broadcast", async () => {
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(me(500, 0))
      .mockResolvedValue(me(180, 0, ["cardBackground:bg_storm_front"]));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({ ok: true } as never);
    const outcome = await purchaseCosmeticInPlace(STORM, "hard");
    expect(outcome.kind).toBe("owned");
    expect(reload).not.toHaveBeenCalled();
    expect(broadcasts).toHaveLength(1);
    expect(showInGameAlert).not.toHaveBeenCalled();
  });

  it("buying it drops a remembered top-up for it", async () => {
    rememberPendingPurchase("p1", "cardBackground:bg_storm_front");
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({ ok: true } as never);
    await purchaseCosmeticInPlace(STORM, "hard");
    expect(peekPendingPurchase("p1")).toBeNull();
  });

  it("already owned: owned, with no error and no reload", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "already_owned",
    } as never);
    const outcome = await purchaseCosmeticInPlace(STORM, "hard");
    expect(outcome.kind).toBe("owned");
    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(broadcasts).toHaveLength(1);
  });

  // purchaseWithCurrency never throws: a network drop, a timeout and a 5xx
  // all come back as {ok: false, code: "failed"}, and a server transaction
  // can still commit after the client has given up on it. So "failed" is
  // never "you weren't charged".
  const FAILED = { ok: false, code: "failed" } as never;

  it("failed, balance unchanged on the re-read: still unconfirmed, never 'not charged'", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue(FAILED);
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
      "unconfirmed",
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("failed, balance moved on the re-read: unconfirmed", async () => {
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(me(500, 0))
      .mockResolvedValue(me(180, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue(FAILED);
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
      "unconfirmed",
    );
  });

  it("failed, but the re-read shows it owned (a lost success): owned", async () => {
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(me(500, 0))
      .mockResolvedValue(me(180, 0, ["cardBackground:bg_storm_front"]));
    vi.mocked(purchaseWithCurrency).mockResolvedValue(FAILED);
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe("owned");
  });

  // The end screen marks the item bought here (onOwned) before the fresh
  // profile lands, or one render sees it owned but not bought here, drops
  // it, and tears the block down and rebuilds it.
  describe("onOwned comes before the fresh profile's broadcast", () => {
    const order = (onOwned: () => void) => {
      const seen: string[] = [];
      const listener = () => seen.push("broadcast");
      document.addEventListener("userMeResponse", listener);
      return {
        seen,
        onOwned: () => {
          seen.push("owned");
          onOwned();
        },
        done: () => document.removeEventListener("userMeResponse", listener),
      };
    };

    it.each([
      ["bought", { ok: true }],
      ["already owned", { ok: false, code: "already_owned" }],
      ["a lost success, owned on the re-read", { ok: false, code: "failed" }],
    ])("%s", async (_name, answer) => {
      vi.mocked(getUserMe)
        .mockResolvedValueOnce(me(500, 0))
        .mockResolvedValue(me(180, 0, ["cardBackground:bg_storm_front"]));
      vi.mocked(purchaseWithCurrency).mockResolvedValue(answer as never);
      const onOwned = vi.fn();
      const o = order(onOwned);
      const outcome = await purchaseCosmeticInPlace(
        STORM,
        "hard",
        undefined,
        o.onOwned,
      );
      o.done();
      expect(outcome.kind).toBe("owned");
      expect(o.seen).toEqual(["owned", "broadcast"]);
      expect(onOwned).toHaveBeenCalledOnce();
    });

    it("not owned on the re-read: never called", async () => {
      vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
      vi.mocked(purchaseWithCurrency).mockResolvedValue(FAILED);
      const onOwned = vi.fn();
      await purchaseCosmeticInPlace(STORM, "hard", undefined, onOwned);
      expect(onOwned).not.toHaveBeenCalled();
    });
  });

  it("failed and the re-read fails too: unconfirmed", async () => {
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(me(500, 0))
      .mockResolvedValue(false);
    vi.mocked(purchaseWithCurrency).mockResolvedValue(FAILED);
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
      "unconfirmed",
    );
  });

  it("a named refusal (insufficient funds, still short): the shortfall, nothing charged", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "insufficient_balance",
    } as never);
    // The balance moved under the confirm: the re-read says 100.
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(me(500, 0))
      .mockResolvedValue(me(100, 0));
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
      "insufficient",
    );
  });

  it("charged something other than the price shown: owned, with the Store's notice", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: true,
      amount: 400,
    } as never);
    const outcome = await purchaseCosmeticInPlace(STORM, "hard");
    expect(outcome.kind).toBe("owned");
    expect((outcome as { notice?: string }).notice).toBeDefined();
  });

  it("sends the price the confirm showed; a price_changed refusal says so, nothing charged", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "price_changed",
      amount: 360,
    } as never);
    const outcome = await purchaseCosmeticInPlace(
      STORM,
      "hard",
      undefined,
      undefined,
      undefined,
      300,
    );
    expect(purchaseWithCurrency).toHaveBeenCalledWith(
      "cardBackground",
      "bg_storm_front",
      "hard",
      undefined,
      undefined,
      { expectedAmount: 300, platform: "web" },
      expect.any(Function),
    );
    // Explained with the Store's message, never "couldn't confirm".
    expect(outcome.kind).toBe("handled");
    expect(showInGameAlert).toHaveBeenCalledWith(
      translateText("store.price_changed"),
    );
    expect(reload).not.toHaveBeenCalled();
  });

  // The box showed 300 and the price is 320 now (a sale ended): a balance of
  // 310 covers what was shown, so the buy is sent and the server decides
  // (price_changed), rather than a top-up for a price never shown.
  it("checks the balance against the lower of the shown and current price", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(310, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({ ok: true } as never);
    const outcome = await purchaseCosmeticInPlace(
      STORM,
      "hard",
      undefined,
      undefined,
      undefined,
      300,
    );
    expect(purchaseWithCurrency).toHaveBeenCalled();
    expect(outcome.kind).not.toBe("insufficient");
  });

  it("judges the re-read against the shown price too", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(310, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "insufficient_balance",
    } as never);
    const outcome = await purchaseCosmeticInPlace(
      STORM,
      "hard",
      undefined,
      undefined,
      undefined,
      300,
    );
    // 310 still covers what was shown: no shortfall to quote.
    expect(outcome.kind).toBe("failed");
  });

  it("the charged-different notice compares with the price shown", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    const buy = (charged: number) => {
      vi.mocked(purchaseWithCurrency).mockResolvedValueOnce({
        ok: true,
        amount: charged,
      } as never);
      return purchaseCosmeticInPlace(
        STORM,
        "hard",
        undefined,
        undefined,
        undefined,
        300,
      );
    };
    // Charged what the box showed (though the catalogue now says 320).
    expect(((await buy(300)) as { notice?: string }).notice).toBeUndefined();
    // Charged the price now, not what was shown: say so.
    expect(((await buy(320)) as { notice?: string }).notice).toBeDefined();
  });

  it("with no shown price, the price check is the price now", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({ ok: true } as never);
    await purchaseCosmeticInPlace(STORM, "hard");
    expect(vi.mocked(purchaseWithCurrency).mock.calls[0]?.[5]).toEqual({
      expectedAmount: 320,
      platform: "web",
    });
  });

  it("charged the price shown: owned, no notice", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: true,
      amount: 320,
    } as never);
    const outcome = await purchaseCosmeticInPlace(STORM, "hard");
    expect((outcome as { notice?: string }).notice).toBeUndefined();
  });

  it("short of Plutonium with enough caps: the shortfall and a caps offer", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(100, 2500));
    const outcome = await purchaseCosmeticInPlace(STORM, "hard");
    expect(outcome).toMatchObject({
      kind: "insufficient",
      info: {
        shortfall: 220,
        canTopUp: true,
        capsPrice: 2000,
        itemKey: "cardBackground:bg_storm_front",
        player: "p1",
        leavesGame: true,
      },
    });
    expect(purchaseWithCurrency).not.toHaveBeenCalled();
  });

  it("short of both: no caps offer", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(100, 500));
    const outcome = await purchaseCosmeticInPlace(STORM, "hard");
    expect(outcome.kind).toBe("insufficient");
    expect(
      (outcome as { info: { capsPrice?: number } }).info.capsPrice,
    ).toBeUndefined();
  });

  it("short of caps: how many more, no top-up", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(0, 1500));
    const outcome = await purchaseCosmeticInPlace(STORM, "soft");
    expect(outcome).toMatchObject({
      kind: "insufficient",
      info: { shortfall: 500, canTopUp: false, leavesGame: true },
    });
  });

  it("bound to the account that opened the confirm: that account buys", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({ ok: true } as never);
    const outcome = await purchaseCosmeticInPlace(
      STORM,
      "hard",
      undefined,
      undefined,
      "p1",
    );
    expect(outcome.kind).toBe("owned");
    expect(purchaseWithCurrency).toHaveBeenCalledOnce();
  });

  it("another account signed in since the confirm opened: nothing sent, the sign-in error", async () => {
    auth.publicId = "p2";
    vi.mocked(getUserMe).mockResolvedValue({
      player: { publicId: "p2", flares: [], currency: { hard: 900 } },
    } as never);
    const outcome = await purchaseCosmeticInPlace(
      STORM,
      "hard",
      undefined,
      undefined,
      "p1",
    );
    expect(outcome.kind).toBe("signed_out");
    expect(purchaseWithCurrency).not.toHaveBeenCalled();
  });

  it("a token refresh inside the purchase picks up another tab's account: signed out", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    // As the real one does: the guard is asked once the token is read.
    vi.mocked(purchaseWithCurrency).mockImplementation(
      async (
        _type,
        _name,
        _method,
        _palette,
        _placement,
        _priceCheck,
        stillWanted,
      ) => {
        auth.publicId = "p2";
        return stillWanted?.() === false
          ? { ok: false, code: "cancelled" }
          : { ok: true };
      },
    );
    const outcome = await purchaseCosmeticInPlace(
      STORM,
      "hard",
      undefined,
      undefined,
      "p1",
    );
    expect(outcome.kind).toBe("signed_out");
    expect(broadcasts).toHaveLength(0);
  });

  it("no session: signed out, nothing bought", async () => {
    auth.session = false;
    vi.mocked(getUserMe).mockResolvedValue(false);
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
      "signed_out",
    );
    expect(purchaseWithCurrency).not.toHaveBeenCalled();
    auth.session = true;
  });

  it("a session but a failed profile read: unreachable, nothing sent", async () => {
    // getUserMe answers (and caches) false for a 5xx too, e.g. another
    // item's tap check failing between this one's confirm and its buy.
    vi.mocked(getUserMe).mockResolvedValue(false);
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
      "unreachable",
    );
    expect(purchaseWithCurrency).not.toHaveBeenCalled();
  });

  it("a failed read and a token near expiry: unreachable, not signed out", async () => {
    // getUserMe's cached false sent no request that would have refreshed
    // the token; the refresh cookie is still good.
    auth.expired = true;
    vi.mocked(getUserMe).mockResolvedValue(false);
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
      "unreachable",
    );
    expect(purchaseWithCurrency).not.toHaveBeenCalled();
  });

  it("the tap check reads the balance fresh, and charges nothing", async () => {
    const order: string[] = [];
    vi.mocked(invalidateUserMe).mockImplementation(() => {
      order.push("invalidate");
    });
    vi.mocked(getUserMe).mockImplementation(async () => {
      order.push("read");
      return me(500, 0);
    });
    expect(await checkInPlacePurchase(STORM, "hard")).toEqual({
      ok: true,
      balance: 500,
    });
    // The cache is dropped first: an older copy can't decide.
    expect(order.slice(0, 2)).toEqual(["invalidate", "read"]);
    expect(purchaseWithCurrency).not.toHaveBeenCalled();
    // The fresh read is broadcast, so the rest of the screen follows.
    expect(broadcasts).toHaveLength(1);
  });

  it("the tap check: short, with the shortfall and the caps offer", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(100, 2500));
    expect(await checkInPlacePurchase(STORM, "hard")).toMatchObject({
      ok: false,
      info: { shortfall: 220, capsPrice: 2000, leavesGame: true },
    });
    expect(purchaseWithCurrency).not.toHaveBeenCalled();
  });

  it("the tap check: no session (none, or a 401 cleared it): signed out", async () => {
    auth.session = false;
    vi.mocked(getUserMe).mockResolvedValue(false);
    expect(await checkInPlacePurchase(STORM, "hard")).toEqual({
      ok: false,
      reason: "signed_out",
    });
    auth.session = true;
  });

  it("the tap check: a session but no profile (the network): unreachable", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    expect(await checkInPlacePurchase(STORM, "hard")).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  describe("the refresh behind the session check", () => {
    // The real userAuth, no token in memory (none yet, or expired and
    // dropped), and /auth/refresh answering `status`.
    // The profile read just before the check refreshed the token (with
    // refresh, through getAuthHeader); `status` is how that went.
    const refreshAnswers = async (status: number) => {
      auth.real = true;
      // The local API base, as AuthRefreshFailure.test.ts sets it.
      const { ClientEnv } = await import("../../src/client/ClientEnv");
      vi.spyOn(ClientEnv, "jwtAudience").mockReturnValue("localhost");
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          status,
          ok: status >= 200 && status < 300,
          json: async () => ({}),
        })),
      );
      const { userAuth } = await import("../../src/client/Auth");
      await userAuth();
    };
    afterEach(async () => {
      auth.real = false;
      const { clearLocalSession } = await import("../../src/client/Auth");
      clearLocalSession();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("a 503: the buy says unreachable, never signed out", async () => {
      await refreshAnswers(503);
      vi.mocked(getUserMe).mockResolvedValue(false);
      expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
        "unreachable",
      );
      expect(purchaseWithCurrency).not.toHaveBeenCalled();
    });

    it("a 503: the tap check says unreachable, never signed out", async () => {
      await refreshAnswers(503);
      vi.mocked(getUserMe).mockResolvedValue(false);
      expect(await checkInPlacePurchase(STORM, "hard")).toEqual({
        ok: false,
        reason: "unreachable",
      });
    });

    it("a 401: signed out, for both", async () => {
      await refreshAnswers(401);
      vi.mocked(getUserMe).mockResolvedValue(false);
      expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
        "signed_out",
      );
      expect(await checkInPlacePurchase(STORM, "hard")).toEqual({
        ok: false,
        reason: "signed_out",
      });
    });
  });

  it("the Store and Inventory still reload after a purchase", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({ ok: true } as never);
    await purchaseCosmetic(STORM, "hard");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the Store and Inventory still reload on already owned", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "already_owned",
    } as never);
    await purchaseCosmetic(STORM, "hard");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the Store's already-owned path drops a remembered top-up for it", async () => {
    rememberPendingPurchase("p1", "cardBackground:bg_storm_front");
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "already_owned",
    } as never);
    await purchaseCosmetic(STORM, "hard");
    expect(peekPendingPurchase("p1")).toBeNull();
  });

  it("the Store's shortfall has no end-screen extras", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(100, 2500));
    const info = await purchaseCosmetic(STORM, "hard");
    expect(info).toMatchObject({ shortfall: 220, canTopUp: true });
    expect((info as { leavesGame?: boolean }).leavesGame).toBeUndefined();
    expect((info as { capsPrice?: number }).capsPrice).toBeUndefined();
  });
});
