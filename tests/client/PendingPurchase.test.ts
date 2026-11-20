import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// "Get Plutonium" from the end screen leaves the game. The item being bought
// is remembered per tab (as PendingEquip remembers one being equipped), and
// once the top-up brings the player back to the site the Store opens on it.

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

const { getUserMe } = await import("../../src/client/Api");
const {
  clearPendingPurchase,
  peekPendingPurchase,
  PENDING_PURCHASE_TTL_MS,
  rememberPendingPurchase,
} = await import("../../src/client/components/inventory/PendingEquip");
const { handlePurchaseReturn, resumePendingPurchase } =
  await import("../../src/client/Cosmetics");

const me = (flares: string[] = [], hard = 500) =>
  ({
    player: { publicId: "p1", flares, currency: { hard, soft: 0 } },
  }) as never;

describe("the pending purchase record", () => {
  afterEach(() => clearPendingPurchase());

  it("is read back for the same player", () => {
    rememberPendingPurchase("p1", "cardBackground:bg_x", 1000);
    expect(peekPendingPurchase("p1", 2000)).toBe("cardBackground:bg_x");
    // Kept until cleared: a read before the top-up lands must not lose it.
    expect(peekPendingPurchase("p1", 2000)).toBe("cardBackground:bg_x");
  });

  it("another player's record is dropped", () => {
    rememberPendingPurchase("p1", "cardBackground:bg_x", 1000);
    expect(peekPendingPurchase("p2", 2000)).toBeNull();
    expect(peekPendingPurchase("p1", 2000)).toBeNull();
  });

  it("expires", () => {
    rememberPendingPurchase("p1", "cardBackground:bg_x", 1000);
    expect(
      peekPendingPurchase("p1", 1000 + PENDING_PURCHASE_TTL_MS + 1),
    ).toBeNull();
    expect(peekPendingPurchase("p1", 1001)).toBeNull();
  });

  it("is separate from the Inventory's pending equip", async () => {
    const equip =
      await import("../../src/client/components/inventory/PendingEquip");
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    expect(equip.peekPendingEquip("p1")).toBeNull();
  });
});

describe("resuming after the top-up", () => {
  beforeEach(() => {
    window.location.hash = "";
    vi.mocked(getUserMe).mockResolvedValue(me());
  });
  afterEach(() => clearPendingPurchase());

  it("opens the Store on the remembered item", async () => {
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    expect(await resumePendingPurchase()).toBe(true);
    expect(window.location.hash).toBe(
      "#modal=store&tab=cosmetics&item=cardBackground%3Abg_x",
    );
  });

  it("does nothing without a record", async () => {
    expect(await resumePendingPurchase()).toBe(false);
    expect(window.location.hash).toBe("");
  });

  it("drops the record when the item is already owned", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me(["cardBackground:bg_x"]));
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    expect(await resumePendingPurchase()).toBe(false);
    expect(peekPendingPurchase("p1")).toBeNull();
  });

  it("does nothing signed out", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    expect(await resumePendingPurchase()).toBe(false);
    expect(window.location.hash).toBe("");
  });

  it("a top-up landing back on the site resumes it", async () => {
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    const actions = {
      strip: vi.fn(),
      alertAndStrip: vi.fn(),
      openTokenLogin: vi.fn(),
      refreshStore: vi.fn(),
      reload: vi.fn(),
      alert: vi.fn().mockResolvedValue(true),
    };
    handlePurchaseReturn(
      new URLSearchParams("status=true&type=currency_pack"),
      actions,
    );
    expect(actions.alertAndStrip).toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(window.location.hash).toBe(
        "#modal=store&tab=cosmetics&item=cardBackground%3Abg_x",
      ),
    );
  });
});
