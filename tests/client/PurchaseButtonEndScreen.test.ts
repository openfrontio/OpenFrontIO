import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsufficientCurrency } from "../../src/client/Cosmetics";

// The end screen's buy buttons: the confirm box says the balance after the
// buy, a buy the player can't afford goes straight to the shortfall box, and
// that box offers caps when they're enough and warns before a top-up leaves
// the game.

vi.mock("../../src/client/Utils", async (orig) => ({
  ...(await orig<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn().mockResolvedValue(true),
  showInGameConfirm: vi.fn().mockResolvedValue(true),
}));

const { PurchaseButton } =
  await import("../../src/client/components/PurchaseButton");
const { InsufficientCurrencyDialog } =
  await import("../../src/client/components/InsufficientCurrencyDialog");
const { clearPendingPurchase, peekPendingPurchase } =
  await import("../../src/client/components/inventory/PendingEquip");
void PurchaseButton;

type Button = InstanceType<typeof PurchaseButton>;
type ConfirmLike = HTMLElement & { message: string };

async function mountButton(props: Partial<Button>) {
  const button = document.createElement("purchase-button") as Button;
  Object.assign(button, {
    itemName: "Storm Front",
    priceHard: 320,
    priceSoft: 2000,
    ...props,
  });
  document.body.appendChild(button);
  await button.updateComplete;
  return button;
}
const hardButton = (b: Button) =>
  b.querySelector<HTMLButtonElement>(".purchase-sparkle-btn-hard")!;
const confirmBox = (b: Button) =>
  b.querySelector("confirm-dialog") as ConfirmLike | null;

describe("end-screen purchase button", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("the confirm box says the balance after the buy", async () => {
    const b = await mountButton({
      balances: { hard: 500, soft: 0 },
      onPurchaseHard: vi.fn(async () => undefined),
    });
    hardButton(b).click();
    await b.updateComplete;
    expect(confirmBox(b)!.message).toBe(
      'store.confirm_purchase_body_left:{"item":"Storm Front","amount":320,"currency":"cosmetics.hard","left":180}',
    );
  });

  it("without balances (the Store) the confirm box is as today", async () => {
    const b = await mountButton({
      onPurchaseHard: vi.fn(async () => undefined),
    });
    hardButton(b).click();
    await b.updateComplete;
    expect(confirmBox(b)!.message).toContain("store.confirm_purchase_body:");
  });

  it("cancel does nothing", async () => {
    const buy = vi.fn(async () => undefined);
    const b = await mountButton({
      balances: { hard: 500, soft: 0 },
      onPurchaseHard: buy,
    });
    hardButton(b).click();
    await b.updateComplete;
    confirmBox(b)!.dispatchEvent(new CustomEvent("cancel"));
    await b.updateComplete;
    expect(confirmBox(b)).toBeNull();
    expect(buy).not.toHaveBeenCalled();
  });

  it("confirming buys", async () => {
    const buy = vi.fn(async () => undefined);
    const b = await mountButton({
      balances: { hard: 500, soft: 0 },
      onPurchaseHard: buy,
    });
    hardButton(b).click();
    await b.updateComplete;
    confirmBox(b)!.dispatchEvent(new CustomEvent("confirm"));
    await vi.waitFor(() => expect(buy).toHaveBeenCalledTimes(1));
  });

  it("short of the price: straight to the shortfall box, no confirm", async () => {
    const info: InsufficientCurrency = {
      currency: "Plutonium",
      shortfall: 220,
      item: "Storm Front",
      canTopUp: true,
      leavesGame: true,
    };
    const buy = vi.fn(async () => info);
    const b = await mountButton({
      balances: { hard: 100, soft: 0 },
      onPurchaseHard: buy,
    });
    hardButton(b).click();
    await vi.waitFor(() => expect(buy).toHaveBeenCalledTimes(1));
    await b.updateComplete;
    expect(confirmBox(b)).toBeNull();
    const dialog = b.querySelector(
      "insufficient-currency-dialog",
    ) as unknown as {
      info: InsufficientCurrency | null;
    };
    expect(dialog.info).toEqual(info);
  });

  it("the caps offer opens the caps confirm", async () => {
    const b = await mountButton({
      balances: { hard: 100, soft: 2500 },
      onPurchaseHard: vi.fn(async () => undefined),
      onPurchaseSoft: vi.fn(async () => undefined),
    });
    b.showInsufficient({
      currency: "Plutonium",
      shortfall: 220,
      item: "Storm Front",
      canTopUp: true,
      leavesGame: true,
      capsPrice: 2000,
    });
    await b.updateComplete;
    b.querySelector("insufficient-currency-dialog")!.dispatchEvent(
      new CustomEvent("buy-caps"),
    );
    await b.updateComplete;
    expect(confirmBox(b)!.message).toContain('"currency":"cosmetics.soft"');
    expect(confirmBox(b)!.message).toContain('"left":500');
  });
});

describe("end-screen shortfall box", () => {
  let dialog: InstanceType<typeof InsufficientCurrencyDialog>;
  const original = window.location.hash;

  beforeEach(() => {
    clearPendingPurchase();
  });
  afterEach(() => {
    dialog?.remove();
    document.body.innerHTML = "";
    window.location.hash = original;
    clearPendingPurchase();
  });

  async function show(info: InsufficientCurrency) {
    dialog = document.createElement(
      "insufficient-currency-dialog",
    ) as InstanceType<typeof InsufficientCurrencyDialog>;
    dialog.info = info;
    document.body.appendChild(dialog);
    await dialog.updateComplete;
    // Rendered on <body>, out of the end screen's transformed modal.
    return document.querySelector("[data-shortfall-box]") as HTMLElement;
  }
  const PLUTONIUM: InsufficientCurrency = {
    currency: "Plutonium",
    shortfall: 220,
    item: "Storm Front",
    canTopUp: true,
    leavesGame: true,
    itemKey: "cardBackground:bg_storm_front",
    player: "p1",
  };
  const action = (box: HTMLElement, name: string) =>
    box.querySelector<HTMLButtonElement>(`[data-shortfall-action='${name}']`);
  // No text under 11px and every target at least 44px high.
  const readable = (box: HTMLElement) => {
    expect(box.innerHTML).not.toMatch(/text-\[(\d|10)px\]/);
    for (const b of box.querySelectorAll("button")) {
      expect(b.className).toMatch(/min-h-11|h-11|min-h-12|h-12/);
    }
  };

  it("says how much more Plutonium is needed, with a top-up", async () => {
    const box = await show(PLUTONIUM);
    expect(box.textContent).toContain(
      'store.insufficient_currency_body:{"amount":220,"currency":"Plutonium","item":"Storm Front"}',
    );
    expect(action(box, "top-up")).not.toBeNull();
    expect(action(box, "caps")).toBeNull();
    readable(box);
  });

  it("offers caps when they're enough", async () => {
    const box = await show({ ...PLUTONIUM, capsPrice: 2000 });
    const caps = action(box, "caps")!;
    expect(caps.textContent).toContain('store.buy_for_caps:{"amount":2000}');
    const heard = vi.fn();
    dialog.addEventListener("buy-caps", heard);
    caps.click();
    expect(heard).toHaveBeenCalled();
    readable(box);
  });

  it("Get Plutonium warns that it leaves the game first", async () => {
    const box = await show(PLUTONIUM);
    action(box, "top-up")!.click();
    await dialog.updateComplete;
    const warn = document.querySelector("[data-shortfall-box]") as HTMLElement;
    expect(warn.textContent).toContain(
      'store.top_up_leaves_game:{"item":"Storm Front"}',
    );
    // Nothing remembered, nowhere gone, until confirmed.
    expect(peekPendingPurchase("p1")).toBeNull();
    expect(window.location.hash).not.toContain("tab=packs");
    readable(warn);
  });

  it("confirming remembers the item and goes to the Plutonium packs", async () => {
    const box = await show(PLUTONIUM);
    action(box, "top-up")!.click();
    await dialog.updateComplete;
    const warn = document.querySelector("[data-shortfall-box]") as HTMLElement;
    action(warn, "leave")!.click();
    expect(peekPendingPurchase("p1")).toBe("cardBackground:bg_storm_front");
    expect(window.location.hash).toBe("#modal=store&tab=packs");
  });

  it("staying keeps the player in the game", async () => {
    const box = await show(PLUTONIUM);
    action(box, "top-up")!.click();
    await dialog.updateComplete;
    const warn = document.querySelector("[data-shortfall-box]") as HTMLElement;
    const closed = vi.fn();
    dialog.addEventListener("close", closed);
    action(warn, "stay")!.click();
    expect(closed).toHaveBeenCalled();
    expect(peekPendingPurchase("p1")).toBeNull();
  });

  it("short of caps: how many more and how to earn them, close only", async () => {
    const box = await show({
      ...PLUTONIUM,
      currency: "caps",
      shortfall: 500,
      canTopUp: false,
    });
    expect(box.textContent).toContain('"amount":500');
    expect(box.textContent).toContain("store.earn_caps_hint");
    expect(action(box, "top-up")).toBeNull();
    expect(action(box, "close")).not.toBeNull();
    readable(box);
  });

  it("the Store's box is as today", async () => {
    dialog = document.createElement(
      "insufficient-currency-dialog",
    ) as InstanceType<typeof InsufficientCurrencyDialog>;
    dialog.info = { ...PLUTONIUM, leavesGame: undefined };
    document.body.appendChild(dialog);
    await dialog.updateComplete;
    expect(dialog.querySelector("confirm-dialog")).not.toBeNull();
    expect(document.querySelector("[data-shortfall-box]")).toBeNull();
  });
});
