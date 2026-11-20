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

  it("a refusal that charged nothing (balance unchanged, not owned): failed", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "failed",
    } as never);
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe("failed");
    expect(reload).not.toHaveBeenCalled();
  });

  it("a refusal after which the balance moved: unconfirmed, not 'not charged'", async () => {
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(me(500, 0))
      .mockResolvedValue(me(180, 0));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "failed",
    } as never);
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
      "unconfirmed",
    );
  });

  it("a lost success response: the re-read shows it owned, so owned", async () => {
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(me(500, 0))
      .mockResolvedValue(me(180, 0, ["cardBackground:bg_storm_front"]));
    vi.mocked(purchaseWithCurrency).mockRejectedValue(new Error("timeout"));
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe("owned");
  });

  it("a network failure, not owned on the re-read: unconfirmed", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(500, 0));
    vi.mocked(purchaseWithCurrency).mockRejectedValue(new Error("offline"));
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
      "unconfirmed",
    );
  });

  it("a refusal, but the re-read shows it owned: owned", async () => {
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(me(500, 0))
      .mockResolvedValue(me(500, 0, ["cardBackground:bg_storm_front"]));
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "failed",
    } as never);
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe("owned");
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

  it("signed out: nothing bought", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    expect((await purchaseCosmeticInPlace(STORM, "hard")).kind).toBe(
      "signed_out",
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

  it("the tap check: signed out, nothing to show", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    expect(await checkInPlacePurchase(STORM, "hard")).toEqual({ ok: false });
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

  it("the Store's shortfall has no end-screen extras", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(100, 2500));
    const info = await purchaseCosmetic(STORM, "hard");
    expect(info).toMatchObject({ shortfall: 220, canTopUp: true });
    expect((info as { leavesGame?: boolean }).leavesGame).toBeUndefined();
    expect((info as { capsPrice?: number }).capsPrice).toBeUndefined();
  });
});
