import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/client/components/PurchaseButton";
import type { PurchaseButton } from "../../src/client/components/PurchaseButton";

describe("PurchaseButton", () => {
  let button: PurchaseButton | undefined;

  afterEach(() => {
    button?.remove();
    button = undefined;
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
});
