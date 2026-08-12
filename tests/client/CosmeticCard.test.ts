import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import "../../src/client/components/CosmeticCard";
import type { CosmeticCard } from "../../src/client/components/CosmeticCard";

const translations = {
  "cosmetics.adfree": "ad-free for life!",
  "cosmetics.artist_label": "Artist:",
  "cosmetics.rare": "Rare",
  "cosmetics.usd_value": "Value: {usd}",
  "cosmetics.verified_name": "Verified username",
  "cosmetics.verified_name_info": "Reserved username",
  "territory_patterns.pattern.stripes": "Ocean Stripes",
  "territory_patterns.color_palette.red": "Crimson",
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

  it("falls back to resolved when the active variant key is missing", async () => {
    const onActivate = vi.fn();
    await createCard();
    card!.resolved = red;
    card!.variants = [red, blue];
    card!.activeVariantKey = "pattern:stripes:missing";
    card!.onActivate = onActivate;
    await card!.updateComplete;

    card!.querySelector<HTMLButtonElement>("[data-cosmetic-main]")!.click();

    expect(onActivate).toHaveBeenCalledWith(red);
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

  it("renders a color swatch for a single palette variant", async () => {
    await createCard();
    card!.variants = [red];
    card!.activeVariantKey = red.key;
    await card!.updateComplete;

    expect(card!.querySelectorAll("[data-variant-key]")).toHaveLength(1);
  });

  it("keeps main and swatch buttons as siblings and renders presentation", async () => {
    installTranslations();
    await createCard();
    card!.variants = [red, blue];
    await card!.updateComplete;

    expect(card!.querySelector("cosmetic-preview")).toBeTruthy();
    expect(card!.querySelector("cosmetic-preview")?.classList).toContain(
      "block",
    );
    expect(card!.querySelector("[data-cosmetic-name]")?.textContent).toContain(
      "Ocean Stripes",
    );
    expect(card!.querySelector('[data-cosmetic-rarity="rare"]')).toBeTruthy();
    expect(card!.querySelectorAll("button button")).toHaveLength(0);
    expect(card!.querySelectorAll("[data-variant-key]")).toHaveLength(2);
  });

  it("does not ellipsize long cosmetic names", async () => {
    installTranslations();
    await createCard();
    card!.resolved = {
      ...red,
      cosmetic: {
        ...red.cosmetic!,
        name: "a_very_long_cosmetic_name",
      } as never,
    };
    await card!.updateComplete;

    const name = card!.querySelector<HTMLElement>("[data-cosmetic-name]")!;
    expect(name.classList).not.toContain("truncate");
    expect(name.classList).toContain("break-words");
  });

  it("keeps metadata and purchase content inside the animated card", async () => {
    installTranslations();
    await createCard();
    card!.resolved = {
      ...red,
      cosmetic: {
        ...red.cosmetic!,
        artist: "Test Artist",
        priceHard: 100,
      } as never,
    };
    card!.actionContent = html`<button data-test-purchase>Buy</button>`;
    await card!.updateComplete;

    const shell = card!.querySelector<HTMLElement>("[data-cosmetic-shell]")!;
    expect(shell.className).toMatch(/hover:-translate-y-1/);
    expect(card!.querySelector("[data-cosmetic-info]")?.textContent).toContain(
      "Artist: Test Artist",
    );
    expect(card!.querySelector("[data-cosmetic-info]")?.textContent).toContain(
      "Value: $5.00",
    );
    expect(
      card!
        .querySelector("[data-cosmetic-info] button")
        ?.getAttribute("aria-label"),
    ).toBe("Show cosmetic details");
    expect(
      card!.querySelector("[data-cosmetic-info] button")?.textContent?.trim(),
    ).toBe("?");
    expect(
      card!.querySelector("[data-test-purchase]")?.closest("cosmetic-card"),
    ).toBe(card);
  });

  it("shows the ad-free entitlement for purchasable cosmetics", async () => {
    installTranslations();
    await createCard();
    card!.resolved = {
      ...red,
      relationship: "purchasable",
      cosmetic: {
        ...red.cosmetic!,
        product: { productId: "pattern", priceId: "pattern", price: "$5" },
      } as never,
    };
    await card!.updateComplete;

    expect(card!.querySelector("[data-cosmetic-info]")?.textContent).toContain(
      "ad-free for life!",
    );
  });

  it("adds rarity hover effects only where the rarity needs them", async () => {
    await createCard();
    expect(card!.querySelector("[data-cosmetic-shimmer]")).toBeNull();
    expect(card!.querySelector("[data-cosmetic-sparkle]")).toBeNull();

    card!.resolved = {
      ...red,
      cosmetic: { ...red.cosmetic!, rarity: "legendary" } as never,
    };
    await card!.updateComplete;

    expect(card!.querySelector("[data-cosmetic-shimmer]")).toBeTruthy();
    expect(card!.querySelector("[data-cosmetic-border-sweep]")).toBeTruthy();
    expect(card!.querySelectorAll("[data-cosmetic-sparkle]")).toHaveLength(4);
  });

  it("keeps the legendary hover border as a visible rotating ring", async () => {
    await createCard();
    card!.resolved = {
      ...red,
      cosmetic: { ...red.cosmetic!, rarity: "legendary" } as never,
    };
    await card!.updateComplete;

    const styles = document.getElementById("cosmetic-card-styles")?.textContent;
    expect(styles).toContain("@keyframes cosmetic-card-border-sweep");
    expect(styles).toContain("border-top-color: rgba(255,220,100,1)");
    expect(styles).toContain("transform-origin: center");
    expect(styles).toContain(
      "cosmetic-card:hover [data-cosmetic-border-sweep]",
    );
  });

  it("does not render swatches when controlled off", async () => {
    await createCard();
    card!.variants = [red, blue];
    card!.showSwatches = false;
    await card!.updateComplete;

    expect(card!.querySelectorAll("[data-variant-key]")).toHaveLength(0);
  });

  it("gives swatches touch-sized buttons with explicit selection state", async () => {
    await createCard();
    card!.variants = [red, blue];
    card!.activeVariantKey = blue.key;
    await card!.updateComplete;

    const swatches = [
      ...card!.querySelectorAll<HTMLButtonElement>("[data-variant-key]"),
    ];
    expect(swatches).toHaveLength(2);
    for (const swatch of swatches) {
      expect(swatch.classList).toContain("h-8");
      expect(swatch.classList).toContain("w-8");
      expect(swatch.querySelector("[data-cosmetic-swatch-dot]")).toBeTruthy();
    }
    expect(swatches[0].getAttribute("aria-pressed")).toBe("false");
    expect(swatches[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("uses neutral rarity accents and visible focus styles", async () => {
    await createCard();
    card!.variants = [red, blue];
    await card!.updateComplete;

    const shell = card!.querySelector<HTMLElement>("[data-cosmetic-rarity]")!;
    const main = card!.querySelector<HTMLButtonElement>(
      "[data-cosmetic-main]",
    )!;
    const swatch =
      card!.querySelector<HTMLButtonElement>("[data-variant-key]")!;

    expect(shell.className).not.toMatch(/emerald|sky|blue/);
    expect(main.className).toMatch(/focus-visible:ring-white/);
    expect(swatch.className).toMatch(/focus-visible:ring-white/);
    expect(main.className).not.toMatch(/ring-blue/);
    expect(swatch.className).not.toMatch(/ring-blue/);
  });

  it("layers green equipped state over the rarity accent", async () => {
    installTranslations();
    await createCard();
    card!.state = "equipped";
    await card!.updateComplete;

    let shell = card!.querySelector<HTMLElement>("[data-cosmetic-rarity]")!;
    const badge = card!.querySelector<HTMLElement>(
      "[data-cosmetic-equipped='true']",
    )!;
    expect(shell.classList).toContain("border-violet-300/70");
    expect(shell.className).toMatch(/ring-emerald/);
    expect(shell.className).not.toMatch(/ring-blue/);
    expect(shell.className).toMatch(/shadow-\[/);
    expect(badge.className).toMatch(/bg-emerald/);
    expect(badge.className).toMatch(/shadow/);

    card!.state = "focused";
    await card!.updateComplete;
    shell = card!.querySelector<HTMLElement>("[data-cosmetic-rarity]")!;
    expect(shell.classList).toContain("border-violet-300/70");
    expect(shell.className).not.toMatch(/ring-blue/);
    expect(shell.className).not.toMatch(/ring-emerald/);
  });
});
