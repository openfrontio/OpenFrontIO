import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import "../../src/client/components/InventoryLoadoutBar";
import type {
  InventoryLoadoutBar,
  InventoryLoadoutEntry,
} from "../../src/client/components/InventoryLoadoutBar";

const cosmetic = (type: ResolvedCosmetic["type"], key: string) =>
  ({
    type,
    cosmetic:
      type === "flag" ? { name: key, url: "/flags/openfront.svg" } : null,
    colorPalette: null,
    relationship: "owned",
    key,
  }) as ResolvedCosmetic;

function entriesForAllCategories(): readonly InventoryLoadoutEntry[] {
  return [
    {
      category: "skins",
      label: "Skin",
      items: [cosmetic("skin", "skin:aurora")],
      summary: "Aurora equipped",
    },
    {
      category: "flags",
      label: "Flag",
      items: [cosmetic("flag", "flag:openfront")],
      summary: "OpenFront equipped",
    },
    {
      category: "crowns",
      label: "Crown",
      items: [cosmetic("crown", "crown:gold")],
      summary: "Gold Crown equipped",
    },
    {
      category: "effects",
      label: "Effects",
      items: [cosmetic("effect", "effect:trail")],
      summary: "1 effect equipped",
    },
  ];
}

describe("InventoryLoadoutBar", () => {
  let bar: InventoryLoadoutBar | undefined;

  afterEach(() => {
    bar?.remove();
    bar = undefined;
  });

  it("renders exactly four category controls and reports navigation", async () => {
    const onCategorySelect = vi.fn();
    bar = document.createElement(
      "inventory-loadout-bar",
    ) as InventoryLoadoutBar;
    bar.entries = entriesForAllCategories();
    bar.activeCategory = "skins";
    bar.onCategorySelect = onCategorySelect;
    document.body.appendChild(bar);
    await bar.updateComplete;

    expect(bar.querySelectorAll("[data-loadout-category]")).toHaveLength(4);
    expect(
      bar
        .querySelector('[data-loadout-category="skins"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    bar
      .querySelector<HTMLButtonElement>('[data-loadout-category="effects"]')!
      .click();
    expect(onCategorySelect).toHaveBeenCalledWith("effects");
  });

  it("limits effects previews to three layers and reports the remainder", async () => {
    bar = document.createElement(
      "inventory-loadout-bar",
    ) as InventoryLoadoutBar;
    bar.entries = entriesForAllCategories().map((entry) =>
      entry.category === "effects"
        ? {
            ...entry,
            items: [
              cosmetic("effect", "effect:one"),
              cosmetic("effect", "effect:two"),
              cosmetic("effect", "effect:three"),
              cosmetic("effect", "effect:four"),
              cosmetic("effect", "effect:five"),
            ],
            summary: "5 effects equipped",
          }
        : entry,
    );
    bar.activeCategory = "effects";
    document.body.appendChild(bar);
    await bar.updateComplete;

    const effects = bar.querySelector('[data-loadout-category="effects"]')!;
    expect(effects.querySelectorAll("[data-loadout-preview]")).toHaveLength(3);
    expect(effects.querySelector("[data-loadout-more]")?.textContent).toBe(
      "+2",
    );
    expect(bar.querySelectorAll("[data-loadout-category]")).toHaveLength(4);
  });
});
