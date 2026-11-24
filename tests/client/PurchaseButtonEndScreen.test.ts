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

// The end screen's buttons check the player's balance on tap, from one fresh
// read that charges nothing (`preflight`), and only then show the confirm box
// or the shortfall box. The paying handler only ever runs from the confirm.
describe("end-screen purchase button", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const ok = (balance: number) => async () => ({ ok: true as const, balance });
  const SHORT: InsufficientCurrency = {
    currency: "Plutonium",
    shortfall: 220,
    item: "Storm Front",
    canTopUp: true,
    leavesGame: true,
  };
  const settle = async (b: Button) => {
    await new Promise((r) => setTimeout(r, 0));
    await b.updateComplete;
  };

  it("the confirm box says the balance after the buy, from the fresh read", async () => {
    const b = await mountButton({
      preflight: ok(500),
      onPurchaseHard: vi.fn(async () => undefined),
    });
    hardButton(b).click();
    await settle(b);
    expect(confirmBox(b)!.message).toBe(
      'store.confirm_purchase_body_left:{"item":"Storm Front","amount":320,"currency":"cosmetics.hard","left":180}',
    );
  });

  it("the balance line keeps the confirmed item's price when the button is reused", async () => {
    const b = await mountButton({
      preflight: ok(500),
      onPurchaseHard: vi.fn(async () => undefined),
    });
    hardButton(b).click();
    await settle(b);
    // A grid rendered by position hands this element another item.
    Object.assign(b, { itemName: "Other item", priceHard: 999 });
    await b.updateComplete;
    expect(confirmBox(b)!.message).toBe(
      'store.confirm_purchase_body_left:{"item":"Storm Front","amount":320,"currency":"cosmetics.hard","left":180}',
    );
  });

  it("the item is the one tapped, even if the button is reused during the balance read", async () => {
    let answer!: (r: { ok: true; balance: number }) => void;
    const b = await mountButton({
      preflight: () => new Promise((r) => (answer = r)),
      onPurchaseHard: vi.fn(async () => undefined),
    });
    hardButton(b).click();
    Object.assign(b, { itemName: "Other item", priceHard: 999 });
    await b.updateComplete;
    answer({ ok: true, balance: 500 });
    await settle(b);
    expect(confirmBox(b)!.message).toBe(
      'store.confirm_purchase_body_left:{"item":"Storm Front","amount":320,"currency":"cosmetics.hard","left":180}',
    );
  });

  it("stale balance short, fresh balance enough: the confirm shows, nothing charged", async () => {
    // Whatever an older copy of the balance said, the tap reads it fresh.
    const preflight = vi.fn(ok(500));
    const buy = vi.fn(async () => undefined);
    const b = await mountButton({ preflight, onPurchaseHard: buy });
    hardButton(b).click();
    await settle(b);
    expect(preflight).toHaveBeenCalledWith("hard");
    expect(confirmBox(b)).not.toBeNull();
    expect(buy).not.toHaveBeenCalled();
  });

  it("can't afford it: the shortfall box, and the paying handler never runs", async () => {
    const buy = vi.fn(async () => undefined);
    const b = await mountButton({
      preflight: async () => ({ ok: false as const, info: SHORT }),
      onPurchaseHard: buy,
    });
    hardButton(b).click();
    await settle(b);
    expect(confirmBox(b)).toBeNull();
    expect(buy).not.toHaveBeenCalled();
    const dialog = b.querySelector(
      "insufficient-currency-dialog",
    ) as unknown as { info: InsufficientCurrency | null };
    expect(dialog.info).toEqual(SHORT);
  });

  it("the check can't run: no confirm and no charge (the check's caller explains why)", async () => {
    const buy = vi.fn(async () => undefined);
    const b = await mountButton({
      preflight: async () => ({ ok: false as const }),
      onPurchaseHard: buy,
    });
    hardButton(b).click();
    await settle(b);
    expect(confirmBox(b)).toBeNull();
    expect(buy).not.toHaveBeenCalled();
  });

  it("a second tap while the check runs is ignored", async () => {
    let release!: () => void;
    const preflight = vi.fn(
      () =>
        new Promise<{ ok: true; balance: number }>((r) => {
          release = () => r({ ok: true, balance: 500 });
        }),
    );
    const b = await mountButton({
      preflight,
      onPurchaseHard: vi.fn(async () => undefined),
    });
    hardButton(b).click();
    hardButton(b).click();
    expect(preflight).toHaveBeenCalledTimes(1);
    release();
    await settle(b);
  });

  it("without a check (the Store) the confirm box is as today", async () => {
    const b = await mountButton({
      onPurchaseHard: vi.fn(async () => undefined),
    });
    hardButton(b).click();
    await b.updateComplete;
    expect(confirmBox(b)!.message).toContain("store.confirm_purchase_body:");
  });

  it("cancel does nothing", async () => {
    const buy = vi.fn(async () => undefined);
    const b = await mountButton({ preflight: ok(500), onPurchaseHard: buy });
    hardButton(b).click();
    await settle(b);
    confirmBox(b)!.dispatchEvent(new CustomEvent("cancel"));
    await b.updateComplete;
    expect(confirmBox(b)).toBeNull();
    expect(buy).not.toHaveBeenCalled();
  });

  it("confirming buys", async () => {
    const buy = vi.fn(async () => undefined);
    const b = await mountButton({ preflight: ok(500), onPurchaseHard: buy });
    hardButton(b).click();
    await settle(b);
    confirmBox(b)!.dispatchEvent(new CustomEvent("confirm"));
    await vi.waitFor(() => expect(buy).toHaveBeenCalledTimes(1));
  });

  it("the caps offer checks caps, then opens the caps confirm", async () => {
    const preflight = vi.fn(async (method: "hard" | "soft") => ({
      ok: true as const,
      balance: method === "soft" ? 2500 : 100,
    }));
    const b = await mountButton({
      preflight,
      onPurchaseHard: vi.fn(async () => undefined),
      onPurchaseSoft: vi.fn(async () => undefined),
    });
    b.showInsufficient({ ...SHORT, capsPrice: 2000 });
    await b.updateComplete;
    b.querySelector("insufficient-currency-dialog")!.dispatchEvent(
      new CustomEvent("buy-caps"),
    );
    await settle(b);
    expect(preflight).toHaveBeenCalledWith("soft");
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
    expect(action(box, "top-up")!.textContent).toContain("store.get_plutonium");
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
    expect(action(warn, "leave")!.textContent).toContain("store.get_plutonium");
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

  // The Inventory's Player card tab buys in place too, but isn't a game:
  // its box is the plain one.
  async function showPlain(info: InsufficientCurrency) {
    dialog = document.createElement(
      "insufficient-currency-dialog",
    ) as InstanceType<typeof InsufficientCurrencyDialog>;
    dialog.info = info;
    document.body.appendChild(dialog);
    await dialog.updateComplete;
    return dialog.querySelector("confirm-dialog")!;
  }

  it("no game to leave: Get Plutonium still remembers the item", async () => {
    const confirm = await showPlain({ ...PLUTONIUM, leavesGame: false });
    confirm.dispatchEvent(new CustomEvent("confirm"));
    expect(peekPendingPurchase("p1")).toBe("cardBackground:bg_storm_front");
    expect(window.location.hash).toBe("#modal=store&tab=packs");
  });

  it("a parent can hold the top-up (the Inventory's unsaved card guard)", async () => {
    const confirm = await showPlain({ ...PLUTONIUM, leavesGame: false });
    let go: (() => void) | null = null;
    // On the dialog itself, so the listener goes with it after the test.
    dialog.addEventListener("top-up", (e) => {
      e.preventDefault();
      go = (e as CustomEvent<{ go: () => void }>).detail.go;
    });
    confirm.dispatchEvent(new CustomEvent("confirm"));
    // Held: nothing remembered, nowhere gone yet.
    expect(peekPendingPurchase("p1")).toBeNull();
    expect(window.location.hash).not.toContain("tab=packs");
    go!();
    expect(peekPendingPurchase("p1")).toBe("cardBackground:bg_storm_front");
    expect(window.location.hash).toBe("#modal=store&tab=packs");
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

// Keyboard: focus moves into the box, Tab stays in it, Escape closes it, and
// focus goes back to the Buy button.
describe("end-screen shortfall box: focus", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  const INFO: InsufficientCurrency = {
    currency: "Plutonium",
    shortfall: 220,
    item: "Storm Front",
    canTopUp: true,
    leavesGame: true,
    capsPrice: 2000,
  };
  async function open() {
    const buy = document.createElement("button");
    buy.textContent = "Buy";
    document.body.appendChild(buy);
    const dialog = document.createElement(
      "insufficient-currency-dialog",
    ) as InstanceType<typeof InsufficientCurrencyDialog>;
    dialog.returnFocus = buy;
    dialog.info = INFO;
    document.body.appendChild(dialog);
    await dialog.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    const box = document.querySelector("[data-shortfall-box]") as HTMLElement;
    return { buy, dialog, box };
  }
  const press = (key: string, shift = false) =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true }),
    );

  it("focus moves into the box on open", async () => {
    const { box } = await open();
    expect(box.contains(document.activeElement)).toBe(true);
  });

  it("Tab stays inside the box, both ways", async () => {
    const { box } = await open();
    const buttons = [...box.querySelectorAll<HTMLButtonElement>("button")];
    buttons[buttons.length - 1]!.focus();
    press("Tab");
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].focus();
    press("Tab", true);
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it("Escape closes it", async () => {
    const { dialog } = await open();
    const closed = vi.fn();
    dialog.addEventListener("close", closed);
    press("Escape");
    expect(closed).toHaveBeenCalled();
  });

  it("closing puts focus back on the Buy button", async () => {
    const { buy, dialog } = await open();
    dialog.addEventListener("close", () => (dialog.info = null));
    press("Escape");
    await dialog.updateComplete;
    expect(document.activeElement).toBe(buy);
  });

  it("the button hands its own Buy to the box", async () => {
    const b = await mountButton({
      preflight: async () => ({ ok: false as const, info: INFO }),
      onPurchaseHard: vi.fn(async () => undefined),
    });
    hardButton(b).click();
    await new Promise((r) => setTimeout(r, 0));
    await b.updateComplete;
    const dialog = b.querySelector(
      "insufficient-currency-dialog",
    ) as unknown as { returnFocus: HTMLElement | null };
    expect(dialog.returnFocus).toBe(hardButton(b));
  });
});
