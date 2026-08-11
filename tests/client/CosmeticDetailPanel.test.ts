import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import "../../src/client/components/CosmeticDetailPanel";
import type { CosmeticDetailPanel } from "../../src/client/components/CosmeticDetailPanel";

const translations = {
  "territory_patterns.pattern.stripes": "Ocean Stripes",
  "territory_patterns.color_palette.red": "Red",
  "territory_patterns.color_palette.blue": "Blue",
};

const red: ResolvedCosmetic = {
  type: "pattern",
  cosmetic: {
    name: "stripes",
    pattern: "AAAAAA",
    product: null,
    rarity: "rare",
    artist: "OpenFront Artist",
  } as never,
  colorPalette: {
    name: "red",
    primaryColor: "#ef4444",
    secondaryColor: "#7f1d1d",
  },
  relationship: "purchasable",
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

describe("CosmeticDetailPanel", () => {
  let panel: CosmeticDetailPanel | undefined;
  let languageFixture: HTMLElement | undefined;

  afterEach(() => {
    panel?.remove();
    languageFixture?.remove();
    panel = undefined;
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

  function createPanel() {
    panel = document.createElement(
      "cosmetic-detail-panel",
    ) as CosmeticDetailPanel;
    return panel;
  }

  it("shows the inspected Store variant and delegates swatches", async () => {
    installTranslations();
    const onVariantActivate = vi.fn();
    panel = createPanel();
    panel.context = "store";
    panel.resolved = red;
    panel.variants = [red, blue];
    panel.activeVariantKey = red.key;
    panel.onVariantActivate = onVariantActivate;
    panel.actionContent = html`<button data-test-action>Buy</button>`;
    document.body.appendChild(panel);
    await panel.updateComplete;

    panel
      .querySelector<HTMLButtonElement>(`[data-detail-variant="${blue.key}"]`)!
      .click();

    expect(onVariantActivate).toHaveBeenCalledWith(blue);
    expect(panel.querySelector("[data-test-action]")).toBeTruthy();
    expect(panel.querySelector("[data-detail-context=store]")).toBeTruthy();
    expect(panel.querySelector("cosmetic-preview")?.getAttribute("size")).toBe(
      "detail",
    );
    expect(
      panel.querySelector("[data-detail-colourway]")?.textContent,
    ).toContain("Red");
  });

  it("shows the Inventory equipped status", async () => {
    installTranslations();
    panel = createPanel();
    panel.context = "inventory";
    panel.resolved = red;
    panel.statusText = "Equipped";
    document.body.appendChild(panel);
    await panel.updateComplete;

    expect(panel.querySelector("[data-detail-context=inventory]")).toBeTruthy();
    expect(panel.querySelector("[data-detail-status]")?.textContent).toContain(
      "Equipped",
    );
  });

  it("clears stale detail content when no cosmetic is resolved", async () => {
    panel = createPanel();
    panel.resolved = red;
    panel.actionContent = html`<button data-test-action>Buy</button>`;
    document.body.appendChild(panel);
    await panel.updateComplete;

    panel.resolved = null;
    await panel.updateComplete;

    expect(panel.querySelector("[data-detail-context]")).toBeNull();
    expect(panel.querySelector("[data-test-action]")).toBeNull();
  });
});
