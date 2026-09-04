import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomCurrencyCheckout } from "../../src/client/Api";
import "../../src/client/components/CustomCurrencyCard";
import type { CustomCurrencyCard } from "../../src/client/components/CustomCurrencyCard";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  createCustomCurrencyCheckout: vi.fn(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn().mockResolvedValue(true),
  showInGameConfirm: vi.fn().mockResolvedValue(true),
}));

const { showInGameAlert } = await import("../../src/client/InGameModal");

describe("CustomCurrencyCard", () => {
  let card: CustomCurrencyCard | undefined;

  beforeEach(() => {
    vi.mocked(createCustomCurrencyCheckout).mockReset();
    vi.mocked(createCustomCurrencyCheckout).mockResolvedValue(false);
    vi.mocked(showInGameAlert).mockClear();
    card = document.createElement("custom-currency-card") as CustomCurrencyCard;
    document.body.appendChild(card);
  });

  afterEach(() => {
    card?.remove();
    card = undefined;
  });

  it("uses the shared card anatomy without obsolete wrapper ancestry", async () => {
    await card!.updateComplete;

    expect(card!.querySelector("[data-custom-currency-card]")).toBeTruthy();
    expect(card!.querySelector("purchase-button")).toBeTruthy();
    // Width comes from the host element so the card shrinks with the pack
    // grid on phones instead of overflowing it.
    const shellClass =
      card!.querySelector("[data-custom-currency-card]")?.className ?? "";
    expect(shellClass).toMatch(/w-full/);
    expect(shellClass).not.toMatch(/w-48/);
    expect(
      card!.querySelector<HTMLElement>("[data-custom-currency-card]")?.dataset
        .cosmeticShell,
    ).toBe("");
    expect(
      card!.querySelector<HTMLElement>("[data-custom-currency-card]")?.style
        .background,
    ).toContain("linear-gradient");
    expect(
      card!.querySelector("[data-custom-currency-preview]")?.className,
    ).toMatch(/flex-col/);
    expect(
      card!.querySelector("[data-custom-currency-name]")?.className,
    ).not.toMatch(/pt-2/);
    // The name leads the card, as it does on cosmetic-card.
    const main = card!.querySelector("[data-cosmetic-main]");
    expect(main).toBeTruthy();
    const name = card!.querySelector("[data-custom-currency-name]");
    expect(name?.className).toMatch(/pt-3/);
    expect(
      name!.compareDocumentPosition(main!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(main!.contains(name)).toBe(false);
    expect(card!.querySelector("[data-cosmetic-action]")?.className).toMatch(
      /w-full/,
    );
    expect(
      card!.querySelector<HTMLElement>("[data-cosmetic-shell]")?.className,
    ).toMatch(/hover:-translate-y-1/);
    expect(
      card!.querySelector<HTMLElement>("[data-cosmetic-shell]")?.className,
    ).toMatch(/hover:shadow-\[0_0_10px/);
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
    expect(numberInput.value).toBe("2000");
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
    expect(showInGameAlert).toHaveBeenCalledWith("store.checkout_failed");
  });
});
