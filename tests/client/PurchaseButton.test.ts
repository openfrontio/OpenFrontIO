import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/client/components/PurchaseButton";
import type { PurchaseButton } from "../../src/client/components/PurchaseButton";

describe("PurchaseButton", () => {
  let button: PurchaseButton | undefined;

  afterEach(() => {
    button?.remove();
    button = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows busy state and suppresses duplicate standalone dollar purchases", async () => {
    let resolvePurchase:
      | ((value: undefined | PromiseLike<undefined>) => void)
      | undefined;
    const purchase = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          resolvePurchase = resolve;
        }),
    );
    button = document.createElement("purchase-button") as PurchaseButton;
    button.dollarPrice = "$5";
    button.onPurchaseDollar = purchase;
    document.body.appendChild(button);
    await button.updateComplete;

    const dollarButton = button.querySelector<HTMLButtonElement>(
      ".purchase-sparkle-btn",
    )!;
    dollarButton.click();
    dollarButton.click();
    await button.updateComplete;

    expect(
      button.querySelector(".purchase-btn-wrap")?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(button.querySelector(".cosmetic-loading-spinner")).toBeTruthy();
    expect(dollarButton.disabled).toBe(true);
    expect(purchase).toHaveBeenCalledTimes(1);

    resolvePurchase!(undefined);
    await vi.waitFor(() =>
      expect(
        button!.querySelector(".purchase-btn-wrap")?.getAttribute("aria-busy"),
      ).toBeNull(),
    );
    expect(button.querySelector(".cosmetic-loading-spinner")).toBeNull();
    expect(
      button.querySelector<HTMLButtonElement>(".purchase-sparkle-btn")!
        .disabled,
    ).toBe(false);
  });

  it("uses blue purchase controls instead of equipped-state green", async () => {
    button = document.createElement("purchase-button") as PurchaseButton;
    button.dollarPrice = "$5";
    button.priceHard = 100;
    button.onPurchaseDollar = vi.fn(async () => undefined);
    button.onPurchaseHard = vi.fn(async () => undefined);
    document.body.appendChild(button);
    await button.updateComplete;

    for (const selector of [
      ".purchase-sparkle-btn",
      ".purchase-sparkle-btn-hard",
    ]) {
      const purchase = button.querySelector<HTMLButtonElement>(selector)!;
      expect(purchase.className).toMatch(/blue/);
      expect(purchase.className).not.toMatch(/green|emerald/);
    }
  });

  it("clears busy state and reports a synchronous purchase throw", async () => {
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    button = document.createElement("purchase-button") as PurchaseButton;
    button.dollarPrice = "$5";
    button.onPurchaseDollar = () => {
      throw new Error("sync purchase failure");
    };
    document.body.appendChild(button);
    await button.updateComplete;

    button.querySelector<HTMLButtonElement>(".purchase-sparkle-btn")!.click();

    await vi.waitFor(() =>
      expect(alertMock).toHaveBeenCalledWith("store.purchase_failed"),
    );
    expect(
      button.querySelector(".purchase-btn-wrap")?.getAttribute("aria-busy"),
    ).toBeNull();
  });

  it("clears busy state and handles a rejected purchase callback", async () => {
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    button = document.createElement("purchase-button") as PurchaseButton;
    button.dollarPrice = "$5";
    button.onPurchaseDollar = async () => {
      throw new Error("rejected purchase failure");
    };
    document.body.appendChild(button);
    await button.updateComplete;

    button.querySelector<HTMLButtonElement>(".purchase-sparkle-btn")!.click();

    await vi.waitFor(() =>
      expect(alertMock).toHaveBeenCalledWith("store.purchase_failed"),
    );
    expect(
      button.querySelector(".purchase-btn-wrap")?.getAttribute("aria-busy"),
    ).toBeNull();
  });

  it("triggers card-level hover styling from any cosmetic shell", async () => {
    button = document.createElement("purchase-button") as PurchaseButton;
    button.dollarPrice = "$5";
    button.onPurchaseDollar = async () => undefined;
    document.body.appendChild(button);
    await button.updateComplete;

    const css =
      document.getElementById("purchase-button-styles")?.textContent ?? "";

    // Hover styling must key off the shared shell attribute so cards that are
    // not <cosmetic-card> (e.g. the custom plutonium card) behave identically.
    expect(css).not.toMatch(/cosmetic-card:hover \.purchase-btn-wrap/);
    for (const target of [
      ".purchase-sparkle-streak",
      ".purchase-sparkle-btn",
      ".purchase-sparkle-btn-hard",
      ".purchase-sparkle-btn-soft",
      ".purchase-ember",
      ".purchase-burst",
    ]) {
      expect(css).toContain(
        `[data-cosmetic-shell]:hover .purchase-btn-wrap ${target}`,
      );
    }
  });
});
