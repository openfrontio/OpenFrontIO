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

  it("matches currentPrice at the moment a sale ends (Store and Inventory agree)", () => {
    const endsAt = new Date(Date.now() - 1).toISOString();
    const item = {
      priceHard: 300,
      listPriceHard: 400,
      promotion: { name: "Winter sale", percentOff: 25, endsAt },
    };
    expect(shownPrice(item, "hard")?.price).toBe(currentPrice(item, "hard"));
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
