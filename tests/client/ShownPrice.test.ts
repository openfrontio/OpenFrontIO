import { afterEach, describe, expect, it, vi } from "vitest";
import type { PurchaseButton } from "../../src/client/components/PurchaseButton";
import { currentPrice } from "../../src/client/Cosmetics";
import { shownPrice } from "../../src/client/ShownPrice";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const LATER = "2026-11-20T12:00:00Z";
const EARLIER = "2026-11-18T12:00:00Z";

describe("shownPrice", () => {
  it("shows the catalogue price with no sale", () => {
    expect(
      shownPrice({ priceHard: 400, priceSoft: 2400 }, "hard", NOW),
    ).toEqual({ price: 400, listPrice: null, saleLabel: null });
    expect(
      shownPrice({ priceHard: 400, priceSoft: 2400 }, "soft", NOW),
    ).toEqual({ price: 2400, listPrice: null, saleLabel: null });
  });

  it("shows the list price and the promotion's name while a sale runs", () => {
    const item = {
      priceHard: 300,
      priceSoft: 1800,
      listPriceHard: 400,
      listPriceSoft: 2400,
      promotion: { name: "Winter sale", percentOff: 25, endsAt: LATER },
    };
    expect(shownPrice(item, "hard", NOW)).toEqual({
      price: 300,
      listPrice: 400,
      saleLabel: "Winter sale",
    });
    expect(shownPrice(item, "soft", NOW)).toEqual({
      price: 1800,
      listPrice: 2400,
      saleLabel: "Winter sale",
    });
  });

  it("labels a flash sale as one", () => {
    const item = {
      priceSoft: 1200,
      listPriceSoft: 2400,
      promotion: {
        name: "flash-42",
        percentOff: 50,
        endsAt: LATER,
        kind: "flash" as const,
      },
    };
    expect(shownPrice(item, "soft", NOW)).toEqual({
      price: 1200,
      listPrice: 2400,
      saleLabel: "store.flash_sale",
    });
  });

  it("charges the list price once the sale has ended, with no label", () => {
    const item = {
      priceHard: 300,
      listPriceHard: 400,
      promotion: { name: "Winter sale", percentOff: 25, endsAt: EARLIER },
    };
    expect(shownPrice(item, "hard", NOW)).toEqual({
      price: 400,
      listPrice: null,
      saleLabel: null,
    });
  });

  describe("edge cases, shown and charged", () => {
    const ended = {
      name: "Old sale",
      percentOff: 25,
      endsAt: new Date(Date.now() - 1).toISOString(),
    };
    const running = {
      ...ended,
      endsAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const invalid = { ...ended, endsAt: "not a date" };
    // Hard-coded: currentPrice reads shownPrice, so comparing the two can't
    // catch a change to the rule.
    const cases: [string, object, number | undefined][] = [
      [
        "a sale that ended a moment ago: the list price",
        { priceHard: 300, listPriceHard: 400, promotion: ended },
        400,
      ],
      [
        "an ended sale with only a list price: the list price",
        { listPriceHard: 400, promotion: ended },
        400,
      ],
      [
        "a running sale: the sale price",
        { priceHard: 300, listPriceHard: 400, promotion: running },
        300,
      ],
      [
        "a running sale with no price: not for sale",
        { listPriceHard: 400, promotion: running },
        undefined,
      ],
      [
        "an endsAt that isn't a date: the sale price",
        { priceHard: 300, listPriceHard: 400, promotion: invalid },
        300,
      ],
      ["no sale: the price", { priceHard: 300 }, 300],
      ["no price: not for sale", {}, undefined],
    ];
    for (const [name, item, expected] of cases) {
      it(name, () => {
        expect(shownPrice(item, "hard")?.price).toBe(expected);
        expect(currentPrice(item, "hard")).toBe(expected);
      });
    }

    it("an ended sale shows no struck price or label", () => {
      expect(
        shownPrice({ listPriceHard: 400, promotion: ended }, "hard"),
      ).toEqual({ price: 400, listPrice: null, saleLabel: null });
    });
  });

  it("is null when the item has no price in that currency", () => {
    expect(shownPrice({ priceHard: 400 }, "soft", NOW)).toBeNull();
    expect(shownPrice({}, "hard", NOW)).toBeNull();
  });

  it("shows a list price above the price as a sale even without a promotion", () => {
    // What <purchase-button> did before: grids that pass only raw prices
    // still strike the list price through.
    expect(
      shownPrice({ priceHard: 300, listPriceHard: 400 }, "hard", NOW),
    ).toEqual({ price: 300, listPrice: 400, saleLabel: null });
  });

  it("ignores a list price that isn't above the price", () => {
    expect(
      shownPrice(
        {
          priceHard: 400,
          listPriceHard: 400,
          promotion: { name: "Sale", percentOff: 0, endsAt: LATER },
        },
        "hard",
        NOW,
      ),
    ).toEqual({ price: 400, listPrice: null, saleLabel: null });
  });
});

describe("<purchase-button> reads prices through shownPrice", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  async function mount(endsAt: string) {
    await import("../../src/client/components/PurchaseButton");
    const button = document.createElement("purchase-button") as PurchaseButton;
    button.priceHard = 300;
    button.listPriceHard = 400;
    button.promotion = { name: "Winter sale", percentOff: 25, endsAt };
    button.onPurchaseHard = async () => undefined;
    document.body.appendChild(button);
    await button.updateComplete;
    return button;
  }

  it("shows the sale price and the struck list price while the sale runs", async () => {
    const button = await mount(new Date(Date.now() + 60_000).toISOString());
    expect(button.textContent).toContain("300");
    expect(button.querySelector("[data-sale-tag]")?.textContent).toContain(
      "400",
    );
  });

  it("charges the list price when the catalogue's sale has already ended", async () => {
    const button = await mount(new Date(Date.now() - 1).toISOString());
    expect(button.querySelector("[data-sale-tag]")).toBeNull();
    expect(button.textContent).toContain("400");
    expect(button.shown("hard")).toEqual({
      price: 400,
      listPrice: null,
      saleLabel: null,
    });
  });

  it("an open confirm dialog shows the list price once the sale ends", async () => {
    const lang = document.createElement("lang-selector");
    const translations = { "store.confirm_purchase_body": "Pay {amount}" };
    Object.assign(lang, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(lang);
    vi.useFakeTimers();
    const button = await mount(new Date(Date.now() + 5_000).toISOString());
    button.requestCurrencyPurchase("hard");
    await button.updateComplete;
    const confirm = () =>
      button.querySelector("confirm-dialog") as unknown as { message: string };
    expect(confirm().message).toContain("300");
    vi.advanceTimersByTime(5_010);
    await button.updateComplete;
    expect(confirm().message).toContain("400");
    expect(confirm().message).not.toContain("300");
  });

  it("an open confirm dialog keeps its item's price when the button is reused for another item", async () => {
    const lang = document.createElement("lang-selector");
    const translations = { "store.confirm_purchase_body": "Pay {amount}" };
    Object.assign(lang, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(lang);
    const button = await mount(new Date(Date.now() + 60_000).toISOString());
    button.requestCurrencyPurchase("hard");
    await button.updateComplete;
    const confirm = () =>
      button.querySelector("confirm-dialog") as unknown as { message: string };
    expect(confirm().message).toContain("300");
    // A grid rendered by position hands this element another item.
    button.priceHard = 999;
    button.listPriceHard = null;
    button.promotion = null;
    button.itemName = "Other item";
    await button.updateComplete;
    expect(confirm().message).toContain("300");
    expect(confirm().message).not.toContain("999");
  });

  it("an open confirm dialog switches at its own item's sale end after the button is reused", async () => {
    const lang = document.createElement("lang-selector");
    const translations = { "store.confirm_purchase_body": "Pay {amount}" };
    Object.assign(lang, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(lang);
    vi.useFakeTimers();
    const button = await mount(new Date(Date.now() + 5_000).toISOString());
    button.requestCurrencyPurchase("hard");
    await button.updateComplete;
    button.priceHard = 999;
    button.listPriceHard = null;
    button.promotion = null;
    await button.updateComplete;
    vi.advanceTimersByTime(5_010);
    await button.updateComplete;
    const confirm = button.querySelector("confirm-dialog") as unknown as {
      message: string;
    };
    expect(confirm.message).toContain("400");
    expect(confirm.message).not.toContain("999");
  });

  it("confirming after the button is reused holds and releases the confirmed item's busy key", async () => {
    let finish!: () => void;
    const button = await mount(new Date(Date.now() + 60_000).toISOString());
    button.busyKey = "crown:a";
    button.onPurchaseHard = () =>
      new Promise<undefined>((resolve) => {
        finish = () => resolve(undefined);
      });
    await button.updateComplete;
    button.requestCurrencyPurchase("hard");
    await button.updateComplete;
    // A grid rendered by position hands this element item B.
    button.busyKey = "crown:b";
    await button.updateComplete;

    const siblingA = await mount(new Date(Date.now() + 60_000).toISOString());
    siblingA.busyKey = "crown:a";
    const siblingB = await mount(new Date(Date.now() + 60_000).toISOString());
    siblingB.busyKey = "crown:b";
    await Promise.all([siblingA.updateComplete, siblingB.updateComplete]);
    const hard = (b: PurchaseButton) =>
      b.querySelector<HTMLButtonElement>(".purchase-sparkle-btn-hard")!;

    button
      .querySelector("confirm-dialog")!
      .dispatchEvent(new CustomEvent("confirm"));
    await Promise.all([siblingA.updateComplete, siblingB.updateComplete]);
    expect(hard(siblingA).disabled).toBe(true);
    expect(hard(siblingB).disabled).toBe(false);

    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.all([siblingA.updateComplete, siblingB.updateComplete]);
    expect(hard(siblingA).disabled).toBe(false);
    expect(hard(siblingB).disabled).toBe(false);
  });

  it("keeps a reopened button busy while the same item's purchase runs", async () => {
    let finish!: () => void;
    const first = await mount(new Date(Date.now() + 60_000).toISOString());
    first.busyKey = "crown:x";
    first.onPurchaseHard = () =>
      new Promise<undefined>((resolve) => {
        finish = () => resolve(undefined);
      });
    await first.updateComplete;
    first.requestCurrencyPurchase("hard");
    await first.updateComplete;
    first
      .querySelector("confirm-dialog")!
      .dispatchEvent(new CustomEvent("confirm"));
    await first.updateComplete;
    first.remove();

    const second = await mount(new Date(Date.now() + 60_000).toISOString());
    second.busyKey = "crown:x";
    await second.updateComplete;
    const hard = second.querySelector<HTMLButtonElement>(
      ".purchase-sparkle-btn-hard",
    )!;
    expect(hard.disabled).toBe(true);
    second.requestCurrencyPurchase("hard");
    await second.updateComplete;
    expect(second.querySelector("confirm-dialog")).toBeNull();

    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await second.updateComplete;
    expect(hard.disabled).toBe(false);
  });

  it("switches to the list price the moment the sale ends", async () => {
    vi.useFakeTimers();
    const button = await mount(new Date(Date.now() + 5_000).toISOString());
    expect(button.querySelector("[data-sale-tag]")).not.toBeNull();
    vi.advanceTimersByTime(5_010);
    await button.updateComplete;
    expect(button.querySelector("[data-sale-tag]")).toBeNull();
    expect(button.textContent).toContain("400");
  });
});
