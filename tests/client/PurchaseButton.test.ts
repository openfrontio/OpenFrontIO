import { afterEach, describe, expect, it, vi } from "vitest";
import type { PurchaseButton } from "../../src/client/components/PurchaseButton";
import { alignPurchaseRows } from "../../src/client/components/PurchaseButton";

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn().mockResolvedValue(true),
  showInGameConfirm: vi.fn().mockResolvedValue(true),
}));

const { showInGameAlert } = await import("../../src/client/InGameModal");

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
    vi.mocked(showInGameAlert).mockClear();
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
      expect(showInGameAlert).toHaveBeenCalledWith("store.purchase_failed"),
    );
    expect(
      button.querySelector(".purchase-btn-wrap")?.getAttribute("aria-busy"),
    ).toBeNull();
  });

  it("clears busy state and handles a rejected purchase callback", async () => {
    vi.mocked(showInGameAlert).mockClear();
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
      expect(showInGameAlert).toHaveBeenCalledWith("store.purchase_failed"),
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

  it("starts the rising particles at the first real button, not a held line", async () => {
    button = document.createElement("purchase-button") as PurchaseButton;
    button.rarity = "epic";
    button.priceHard = 99;
    button.onPurchaseHard = async () => undefined;
    button.reserveDollar = true;
    document.body.appendChild(button);
    await button.updateComplete;

    const wrap = () =>
      button!.querySelector<HTMLElement>(".purchase-btn-wrap")!;
    // One held line above (min-h-11 plus the column's gap-1) = 3rem.
    expect(wrap().style.getPropertyValue("--purchase-particle-top")).toBe(
      "3rem",
    );
    expect(
      document.getElementById("purchase-button-styles")?.textContent,
    ).toContain("top: var(--purchase-particle-top, 0px)");

    button.reserveDollar = false;
    await button.updateComplete;
    expect(wrap().style.getPropertyValue("--purchase-particle-top")).toBe(
      "0rem",
    );
  });

  describe("alignPurchaseRows", () => {
    const make = (offsetTop: number, kind: "dollar" | "hard" | "soft") => {
      const el = document.createElement("purchase-button") as PurchaseButton;
      if (kind === "dollar") {
        el.dollarPrice = "$5";
        el.onPurchaseDollar = async () => undefined;
      } else if (kind === "hard") {
        el.priceHard = 99;
        el.onPurchaseHard = async () => undefined;
      } else {
        el.priceSoft = 50;
        el.onPurchaseSoft = async () => undefined;
      }
      Object.defineProperty(el, "offsetTop", { value: offsetTop });
      return el;
    };

    it("reserves only the currencies present in each row", async () => {
      const root = document.createElement("div");
      const [rowOneDollar, rowOneHard, rowTwoHard] = [
        make(0, "dollar"),
        make(0, "hard"),
        make(200, "hard"),
      ];
      root.append(rowOneDollar, rowOneHard, rowTwoHard);
      document.body.appendChild(root);
      await Promise.all(
        [rowOneDollar, rowOneHard, rowTwoHard].map((el) => el.updateComplete),
      );

      alignPurchaseRows(root);
      await Promise.all(
        [rowOneDollar, rowOneHard, rowTwoHard].map((el) => el.updateComplete),
      );

      // Row one mixes dollars and plutonium, so both cards keep both lines.
      expect(rowOneDollar.reserveHard).toBe(true);
      expect(rowOneHard.reserveDollar).toBe(true);
      // Row two is plutonium-only: no dollar line, and no caps line anywhere.
      expect(rowTwoHard.reserveDollar).toBe(false);
      expect(rowTwoHard.reserveHard).toBe(true);
      expect(rowOneDollar.reserveSoft).toBe(false);
      expect(rowTwoHard.reserveSoft).toBe(false);
      expect(rowTwoHard.querySelectorAll(".flex.flex-col > *")).toHaveLength(1);

      root.remove();
    });
  });
});
