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
const {
  cancelPendingResume,
  handlePurchaseReturn,
  resumePendingPurchase,
  setGameInProgress,
} = await import("../../src/client/Cosmetics");

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

  it("on a fresh landing, waits for the app's first profile", async () => {
    // The landing runs before the page has signed in: no profile yet.
    vi.mocked(getUserMe).mockResolvedValue(false);
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    const resumed = resumePendingPurchase();
    await Promise.resolve();
    document.dispatchEvent(new CustomEvent("userMeResponse", { detail: me() }));
    expect(await resumed).toBe(true);
    expect(window.location.hash).toBe(
      "#modal=store&tab=cosmetics&item=cardBackground%3Abg_x",
    );
  });

  it("in-page (the profile already known): no waiting", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    expect(await resumePendingPurchase({ waitForProfile: false })).toBe(false);
  });

  it("does nothing signed out", async () => {
    vi.useFakeTimers();
    vi.mocked(getUserMe).mockResolvedValue(false);
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    const resumed = resumePendingPurchase();
    await vi.advanceTimersByTimeAsync(20_000);
    vi.useRealTimers();
    expect(await resumed).toBe(false);
    expect(window.location.hash).toBe("");
  });

  const landing = (status: string) => {
    let closeAlert!: () => void;
    const actions = {
      strip: vi.fn(),
      alertAndStrip: vi.fn(),
      openTokenLogin: vi.fn(),
      refreshStore: vi.fn(),
      reload: vi.fn(),
      alert: vi.fn(
        () => new Promise<unknown>((r) => (closeAlert = () => r(true))),
      ),
    };
    handlePurchaseReturn(
      new URLSearchParams(`status=${status}&type=currency_pack`),
      actions,
    );
    return { actions, closeAlert: () => closeAlert() };
  };
  const ITEM_HASH = "#modal=store&tab=cosmetics&item=cardBackground%3Abg_x";

  it("a top-up landing opens the item only after the success message closes", async () => {
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    const { actions, closeAlert } = landing("true");
    expect(actions.strip).toHaveBeenCalled();
    expect(actions.alert).toHaveBeenCalledWith(
      "store.currency_pack_purchase_success",
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(window.location.hash).toBe("");
    closeAlert();
    await vi.waitFor(() => expect(window.location.hash).toBe(ITEM_HASH));
  });

  it("the in-page form's resume landing: no second message, straight to the resume", async () => {
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    const actions = {
      strip: vi.fn(),
      alertAndStrip: vi.fn(),
      openTokenLogin: vi.fn(),
      refreshStore: vi.fn(),
      reload: vi.fn(),
      alert: vi.fn(async () => true),
    };
    handlePurchaseReturn(
      new URLSearchParams("status=true&type=currency_pack&resume=1"),
      actions,
    );
    expect(actions.strip).toHaveBeenCalled();
    expect(actions.alert).not.toHaveBeenCalled();
    expect(actions.alertAndStrip).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(window.location.hash).toBe(ITEM_HASH));
  });

  it("a landing with nothing remembered is as today", () => {
    const { actions } = landing("true");
    expect(actions.alertAndStrip).toHaveBeenCalledWith(
      "store.currency_pack_purchase_success",
    );
  });

  it("a pending top-up keeps the record for the next visit", async () => {
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    landing("pending");
    await new Promise((r) => setTimeout(r, 20));
    expect(window.location.hash).toBe("");
    expect(peekPendingPurchase("p1")).toBe("cardBackground:bg_x");
  });
});

// The Plutonium can lag the redirect (the rail's webhook): the Store waits
// for it, saying so, before opening the item to buy.
describe("resuming before the Plutonium lands", () => {
  const CATALOGUE = {
    patterns: {},
    flags: {},
    cardBackgrounds: {
      bg_x: {
        name: "bg_x",
        product: null,
        rarity: "epic",
        url: "/bg.webp",
        priceHard: 300,
      },
    },
  };
  let toasts: string[];
  const onToast = (e: Event) =>
    toasts.push((e as CustomEvent<{ message: string }>).detail.message);

  beforeEach(() => {
    // The catalogue's URL comes from the page's bootstrap config.
    (window as unknown as { BOOTSTRAP_CONFIG: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      cluster: { a: { host: "localhost", numWorkers: 1 } },
      instanceLetter: "a",
      turnstileSiteKey: "k",
      jwtAudience: "localhost",
      instanceId: "i",
      gitCommit: "abc",
    };
    window.location.hash = "";
    toasts = [];
    window.addEventListener("show-message", onToast);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(CATALOGUE))),
    );
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.removeEventListener("show-message", onToast);
    delete (window as unknown as { BOOTSTRAP_CONFIG?: unknown })
      .BOOTSTRAP_CONFIG;
    clearPendingPurchase();
  });

  it("says it's on its way, then opens the item once it lands", async () => {
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(me([], 100))
      .mockResolvedValueOnce(me([], 100))
      .mockResolvedValue(me([], 400));
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    const resumed = resumePendingPurchase({ waitForProfile: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(toasts).toEqual(["store.plutonium_on_its_way"]);
    expect(window.location.hash).toBe("");
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await resumed).toBe(true);
    expect(window.location.hash).toBe(
      "#modal=store&tab=cosmetics&item=cardBackground%3Abg_x",
    );
  });

  it("opens it anyway after about 30 seconds", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me([], 100));
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    const resumed = resumePendingPurchase({ waitForProfile: false });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(window.location.hash).toBe("");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await resumed).toBe(true);
    expect(window.location.hash).toBe(
      "#modal=store&tab=cosmetics&item=cardBackground%3Abg_x",
    );
  });

  it("cancelled while it waits: never opens the Store, keeps the record", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me([], 100));
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    const resumed = resumePendingPurchase({ waitForProfile: false });
    await vi.advanceTimersByTimeAsync(4_000);
    cancelPendingResume();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await resumed).toBe(false);
    expect(window.location.hash).toBe("");
    expect(peekPendingPurchase("p1")).toBe("cardBackground:bg_x");
  });

  it("navigating elsewhere while it waits cancels it", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me([], 100));
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    const resumed = resumePendingPurchase({ waitForProfile: false });
    await vi.advanceTimersByTimeAsync(4_000);
    window.location.hash = "#modal=account";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await resumed).toBe(false);
    expect(window.location.hash).toBe("#modal=account");
  });

  it("a game starting while it waits cancels it", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me([], 100));
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    const resumed = resumePendingPurchase({ waitForProfile: false });
    await vi.advanceTimersByTimeAsync(4_000);
    setGameInProgress(true);
    await vi.advanceTimersByTimeAsync(40_000);
    setGameInProgress(false);
    expect(await resumed).toBe(false);
    expect(window.location.hash).toBe("");
  });

  it("never sets the Store hash while a game is running", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me([], 500));
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    setGameInProgress(true);
    expect(await resumePendingPurchase({ waitForProfile: false })).toBe(false);
    setGameInProgress(false);
    expect(window.location.hash).toBe("");
    expect(peekPendingPurchase("p1")).toBe("cardBackground:bg_x");
  });

  it("a late hashchange for the hash it started on doesn't cancel it", async () => {
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(me([], 100))
      .mockResolvedValue(me([], 400));
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    const resumed = resumePendingPurchase({ waitForProfile: false });
    await vi.advanceTimersByTimeAsync(1_000);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await resumed).toBe(true);
  });

  it("enough already: opens straight away, no message", async () => {
    vi.mocked(getUserMe).mockResolvedValue(me([], 500));
    rememberPendingPurchase("p1", "cardBackground:bg_x");
    expect(await resumePendingPurchase({ waitForProfile: false })).toBe(true);
    expect(toasts).toEqual([]);
  });
});
