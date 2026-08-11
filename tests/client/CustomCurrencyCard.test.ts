import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomCurrencyCheckout } from "../../src/client/Api";
import "../../src/client/components/CustomCurrencyCard";
import type { CustomCurrencyCard } from "../../src/client/components/CustomCurrencyCard";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  createCustomCurrencyCheckout: vi.fn(),
}));

describe("CustomCurrencyCard", () => {
  let card: CustomCurrencyCard | undefined;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(createCustomCurrencyCheckout).mockReset();
    vi.mocked(createCustomCurrencyCheckout).mockResolvedValue(false);
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    card = document.createElement("custom-currency-card") as CustomCurrencyCard;
    document.body.appendChild(card);
  });

  afterEach(() => {
    card?.remove();
    card = undefined;
    alertSpy.mockRestore();
  });

  it("uses the shared card anatomy without obsolete wrapper ancestry", async () => {
    await card!.updateComplete;

    expect(card!.querySelector("[data-custom-currency-card]")).toBeTruthy();
    expect(card!.querySelector("purchase-button")).toBeTruthy();
  });

  it("clamps number and range amounts to the supported bounds", async () => {
    await card!.updateComplete;
    const numberInput = card!.querySelector<HTMLInputElement>(
      'input[type="number"]',
    )!;
    const rangeInput = card!.querySelector<HTMLInputElement>(
      'input[type="range"]',
    )!;

    numberInput.value = "4";
    numberInput.dispatchEvent(new Event("change"));
    await card!.updateComplete;
    expect(numberInput.value).toBe("20");

    rangeInput.value = "2001";
    rangeInput.dispatchEvent(new Event("input"));
    await card!.updateComplete;
    expect(rangeInput.value).toBe("2000");
  });

  it("starts custom checkout through its standalone PurchaseButton", async () => {
    await card!.updateComplete;
    const numberInput = card!.querySelector<HTMLInputElement>(
      'input[type="number"]',
    )!;
    numberInput.value = "240";
    numberInput.dispatchEvent(new Event("change"));
    await card!.updateComplete;

    card!.querySelector<HTMLButtonElement>(".purchase-sparkle-btn")!.click();

    await vi.waitFor(() =>
      expect(createCustomCurrencyCheckout).toHaveBeenCalledWith(240),
    );
    expect(alertSpy).toHaveBeenCalledWith("store.checkout_failed");
  });
});
