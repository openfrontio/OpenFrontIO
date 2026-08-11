import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import "../../src/client/components/CosmeticCard";
import type { CosmeticCard } from "../../src/client/components/CosmeticCard";

const translations = {
  "territory_patterns.pattern.stripes": "Ocean Stripes",
};

const red: ResolvedCosmetic = {
  type: "pattern",
  cosmetic: {
    name: "stripes",
    pattern: "AAAAAA",
    product: null,
    rarity: "rare",
  } as never,
  colorPalette: {
    name: "red",
    primaryColor: "#ef4444",
    secondaryColor: "#7f1d1d",
  },
  relationship: "owned",
  key: "pattern:stripes:red",
};

const blue: ResolvedCosmetic = {
  ...red,
  colorPalette: {
    name: "blue",
    primaryColor: "#3b82f6",
    secondaryColor: "#1e3a8a",
  },
  key: "pattern:stripes:blue",
};

describe("CosmeticCard", () => {
  let card: CosmeticCard | undefined;
  let languageFixture: HTMLElement | undefined;

  afterEach(() => {
    card?.remove();
    languageFixture?.remove();
    card = undefined;
    languageFixture = undefined;
  });

  function installTranslations() {
    languageFixture = document.createElement("lang-selector");
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
  }

  async function createCard() {
    card = document.createElement("cosmetic-card") as CosmeticCard;
    card.resolved = red;
    document.body.appendChild(card);
    await card.updateComplete;
  }

  it("distinguishes focus from equipped state", async () => {
    await createCard();
    card!.resolved = blue;
    card!.state = "equipped";
    await card!.updateComplete;

    expect(card!.dataset.cosmeticState).toBe("equipped");
    expect(card!.querySelector('[data-cosmetic-equipped="true"]')).toBeTruthy();
    expect(card!.querySelector("button")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(card!.querySelector("button")?.getAttribute("aria-current")).toBe(
      null,
    );

    card!.state = "focused";
    await card!.updateComplete;
    expect(card!.dataset.cosmeticState).toBe("focused");
    expect(card!.querySelector('[data-cosmetic-equipped="true"]')).toBeNull();
    expect(card!.querySelector("button")?.getAttribute("aria-pressed")).toBe(
      null,
    );
    expect(card!.querySelector("button")?.getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("activates the controlled active variant from the main button", async () => {
    const onActivate = vi.fn();
    await createCard();
    card!.resolved = red;
    card!.variants = [red, blue];
    card!.activeVariantKey = blue.key;
    card!.onActivate = onActivate;
    await card!.updateComplete;

    card!.querySelector<HTMLButtonElement>("[data-cosmetic-main]")!.click();

    expect(onActivate).toHaveBeenCalledWith(blue);
  });

  it("activates a swatch without activating the parent item", async () => {
    const onActivate = vi.fn();
    const onVariantActivate = vi.fn();
    await createCard();
    card!.resolved = red;
    card!.variants = [red, blue];
    card!.activeVariantKey = red.key;
    card!.onActivate = onActivate;
    card!.onVariantActivate = onVariantActivate;
    await card!.updateComplete;

    card!
      .querySelector<HTMLButtonElement>(`[data-variant-key="${blue.key}"]`)!
      .click();

    expect(onVariantActivate).toHaveBeenCalledWith(blue);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("keeps main and swatch buttons as siblings and renders presentation", async () => {
    installTranslations();
    await createCard();
    card!.variants = [red, blue];
    await card!.updateComplete;

    expect(card!.querySelector("cosmetic-preview")).toBeTruthy();
    expect(card!.querySelector("[data-cosmetic-name]")?.textContent).toContain(
      "Ocean Stripes",
    );
    expect(card!.querySelector('[data-cosmetic-rarity="rare"]')).toBeTruthy();
    expect(card!.querySelectorAll("button button")).toHaveLength(0);
    expect(card!.querySelectorAll("[data-variant-key]")).toHaveLength(2);
  });

  it("does not render swatches when controlled off", async () => {
    await createCard();
    card!.variants = [red, blue];
    card!.showSwatches = false;
    await card!.updateComplete;

    expect(card!.querySelectorAll("[data-variant-key]")).toHaveLength(0);
  });
});
