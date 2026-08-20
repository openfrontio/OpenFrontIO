import { afterEach, describe, expect, it, vi } from "vitest";
import { purchaseCosmetic } from "../../src/client/Cosmetics";
import type { CosmeticCard } from "../../src/client/components/CosmeticCard";
import "../../src/client/components/EffectsGrid";
import type { EffectsGrid } from "../../src/client/components/EffectsGrid";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import {
  EFFECT_TYPES,
  NUKE_EXPLOSION_TYPES,
  type Cosmetics,
} from "../../src/core/CosmeticSchemas";
import { EFFECTS_KEY, UserSettings } from "../../src/core/game/UserSettings";

vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  purchaseCosmetic: vi.fn(),
}));

const common = {
  product: null,
  rarity: "common",
  affiliateCode: null,
} as const;

const effectCatalog = {
  patterns: {},
  flags: {},
  crowns: {},
  skins: {},
  effects: {
    transportShipTrail: {
      owned_wake: {
        ...common,
        name: "owned_wake",
        effectType: "transportShipTrail",
        attributes: {
          type: "gradient",
          colors: ["#ffffff"],
          colorSize: 1,
          movementSpeed: 1,
        },
      },
    },
    nukeExplosion: {
      owned_atom: {
        ...common,
        name: "owned_atom",
        effectType: "nukeExplosion",
        attributes: {
          type: "shockwave",
          nukeType: "atom",
          colors: ["#ffffff"],
          size: 1,
          speed: 1,
          thickness: 1,
          transitionSpeed: 1,
        },
      },
      owned_hydro: {
        ...common,
        name: "owned_hydro",
        effectType: "nukeExplosion",
        attributes: {
          type: "shockwave",
          nukeType: "hydro",
          colors: ["#00ffff"],
          size: 1,
          speed: 1,
          thickness: 1,
          transitionSpeed: 1,
        },
      },
      owned_mirv: {
        ...common,
        name: "owned_mirv_warhead",
        effectType: "nukeExplosion",
        attributes: {
          type: "shockwave",
          nukeType: "mirvWarhead",
          colors: ["#ff00ff"],
          size: 1,
          speed: 1,
          thickness: 1,
          transitionSpeed: 1,
        },
      },
      locked_hydro: {
        ...common,
        name: "locked_hydro",
        effectType: "nukeExplosion",
        priceHard: 100,
        attributes: {
          type: "shockwave",
          nukeType: "hydro",
          colors: ["#000000"],
          size: 1,
          speed: 1,
          thickness: 1,
          transitionSpeed: 1,
        },
      },
      locked_hydro_alt: {
        ...common,
        name: "locked_hydro_alt",
        effectType: "nukeExplosion",
        priceHard: 100,
        attributes: {
          type: "shockwave",
          nukeType: "hydro",
          colors: ["#111111"],
          size: 1,
          speed: 1,
          thickness: 1,
          transitionSpeed: 1,
        },
      },
    },
  },
} as unknown as Cosmetics;

const ownedUser = {
  user: {},
  player: {
    publicId: "effects-grid-test-player",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
    currency: { soft: 0, hard: 0 },
    flares: [
      "effect:owned_wake",
      "effect:owned_atom",
      "effect:owned_hydro",
      "effect:owned_mirv",
    ],
  },
} as unknown as UserMeResponse;

function effectCard(grid: EffectsGrid, key: string): CosmeticCard | undefined {
  return [...grid.querySelectorAll<CosmeticCard>("cosmetic-card")].find(
    (card) => card.resolved.key === key,
  );
}

function clickEffectType(
  grid: EffectsGrid,
  type: (typeof EFFECT_TYPES)[number],
) {
  grid
    .querySelectorAll<HTMLButtonElement>("button[class*='-mb-px']")
    [EFFECT_TYPES.indexOf(type)]!.click();
}

function clickNukeType(
  grid: EffectsGrid,
  type: (typeof NUKE_EXPLOSION_TYPES)[number],
) {
  grid
    .querySelectorAll<HTMLButtonElement>("button[class*='rounded-full']")
    [NUKE_EXPLOSION_TYPES.indexOf(type)]!.click();
}

async function createGrid(): Promise<EffectsGrid> {
  const grid = document.createElement("effects-grid") as EffectsGrid;
  grid.cosmetics = effectCatalog;
  grid.userMeResponse = ownedUser;
  document.body.appendChild(grid);
  await grid.updateComplete;
  return grid;
}

describe("EffectsGrid", () => {
  let grid: EffectsGrid | undefined;
  let languageFixture: HTMLElement | undefined;

  afterEach(() => {
    grid?.remove();
    grid = undefined;
    languageFixture?.remove();
    languageFixture = undefined;
    localStorage.clear();
    vi.mocked(purchaseCosmetic).mockReset();
  });

  function installTranslations() {
    const translations = {
      "inventory.selected_cosmetic": "Selected {name}",
      "effects.owned_wake": "Localized Wake",
    };
    languageFixture = document.createElement("lang-selector");
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
  }

  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;

  it("reports the exact atom/hydro/MIRV slot when sub-tabs change", async () => {
    const onActiveSlotChange = vi.fn();
    new UserSettings().setSelectedEffectName("hydro", "owned_hydro");
    grid = document.createElement("effects-grid") as EffectsGrid;
    grid.mode = "select";
    grid.tabbed = true;
    grid.cosmetics = effectCatalog;
    grid.userMeResponse = ownedUser;
    grid.onActiveSlotChange = onActiveSlotChange;
    document.body.appendChild(grid);
    await grid.updateComplete;

    clickEffectType(grid, "nukeExplosion");
    await grid.updateComplete;
    expect(onActiveSlotChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ effectType: "nukeExplosion", slot: "atom" }),
    );
    clickNukeType(grid, "hydro");
    await grid.updateComplete;

    expect(onActiveSlotChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        effectType: "nukeExplosion",
        slot: "hydro",
        resolved: expect.objectContaining({
          key: "effect:nukeExplosion:owned_hydro",
        }),
      }),
    );
    clickNukeType(grid, "mirvWarhead");
    await grid.updateComplete;
    expect(onActiveSlotChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        effectType: "nukeExplosion",
        slot: "mirvWarhead",
      }),
    );
  });

  it("styles the effect-type tab bar like the store's own tab bar", async () => {
    grid = await createGrid();
    grid.tabbed = true;
    grid.requestUpdate();
    await grid.updateComplete;

    const tab = grid.querySelector<HTMLButtonElement>(
      "button[class*='-mb-px']",
    )!;
    // Matches the o-modal tab bar (px-4 py-3 text-sm font-bold) and stays on
    // one line, so the nested bar is neither bolder nor taller than its parent.
    for (const token of [
      "px-4",
      "py-3",
      "text-sm",
      "font-bold",
      "uppercase",
      "tracking-wider",
      "whitespace-nowrap",
    ]) {
      expect(tab.classList.contains(token)).toBe(true);
    }
    expect(tab.classList.contains("font-black")).toBe(false);
  });

  it("marks the stored effect equipped and clears its exact slot with Unequip", async () => {
    const settings = new UserSettings();
    settings.setSelectedEffectName("hydro", "owned_hydro");
    grid = await createGrid();
    grid.tabbed = true;
    grid.requestUpdate();
    await grid.updateComplete;

    clickEffectType(grid, "nukeExplosion");
    await grid.updateComplete;
    clickNukeType(grid, "hydro");
    await grid.updateComplete;

    expect(effectCard(grid, "effect:nukeExplosion:owned_hydro")?.state).toBe(
      "equipped",
    );
    expect(effectCard(grid, "effect:none:nukeExplosion")).toBeUndefined();

    grid.querySelector<HTMLButtonElement>("[data-effects-unequip]")!.click();
    expect(settings.getSelectedEffectName("hydro")).toBeNull();
  });

  it("announces an equipped effect but stays quiet on Unequip", async () => {
    installTranslations();
    const onMessage = vi.fn();
    window.addEventListener("show-message", onMessage);
    try {
      grid = await createGrid();
      grid.effectType = "transportShipTrail";
      grid.requestUpdate();
      await grid.updateComplete;

      const card = effectCard(grid, "effect:transportShipTrail:owned_wake")!;
      await card.updateComplete;
      card.querySelector<HTMLButtonElement>("[data-cosmetic-main]")!.click();

      expect((onMessage.mock.lastCall?.[0] as CustomEvent).detail.message).toBe(
        "Selected Localized Wake",
      );

      // Unequip picks nothing, so it has nothing to announce.
      onMessage.mockClear();
      grid.querySelector<HTMLButtonElement>("[data-effects-unequip]")!.click();
      expect(onMessage).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("show-message", onMessage);
    }
  });

  it("does not render an unscoped Unequip action in the all-types view", async () => {
    grid = await createGrid();
    expect(grid.querySelector("[data-effects-unequip]")).toBeNull();

    const onActiveSlotChange = vi.fn();
    grid.effectType = "nukeExplosion";
    grid.onActiveSlotChange = onActiveSlotChange;
    grid.requestUpdate();
    await grid.updateComplete;

    clickNukeType(grid, "hydro");
    await grid.updateComplete;
    expect(onActiveSlotChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ effectType: "nukeExplosion", slot: "hydro" }),
    );
    expect(grid.querySelector("[data-effects-unequip]")).toBeTruthy();
  });

  it("focuses purchases without initiating a purchase", async () => {
    const onPurchaseFocus = vi.fn();
    grid = await createGrid();
    grid.mode = "purchase";
    grid.tabbed = true;
    grid.onPurchaseFocus = onPurchaseFocus;
    grid.requestUpdate();
    await grid.updateComplete;

    clickEffectType(grid, "nukeExplosion");
    await grid.updateComplete;
    clickNukeType(grid, "hydro");
    await grid.updateComplete;

    const locked = effectCard(grid, "effect:nukeExplosion:locked_hydro")!;
    locked.onActivate!(locked.resolved);
    expect(onPurchaseFocus).toHaveBeenCalledWith(locked.resolved);
    expect(purchaseCosmetic).not.toHaveBeenCalled();
    expect(localStorage.getItem(EFFECTS_KEY)).toBeNull();
  });

  it("reports visible purchases when the nuke sub-tab changes", async () => {
    const onVisiblePurchaseItemsChange = vi.fn();
    grid = await createGrid();
    grid.mode = "purchase";
    grid.tabbed = true;
    grid.onVisiblePurchaseItemsChange = onVisiblePurchaseItemsChange;
    grid.requestUpdate();
    await grid.updateComplete;

    clickEffectType(grid, "nukeExplosion");
    await grid.updateComplete;
    clickNukeType(grid, "hydro");
    await grid.updateComplete;

    expect(onVisiblePurchaseItemsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ key: "effect:nukeExplosion:locked_hydro" }),
      expect.objectContaining({
        key: "effect:nukeExplosion:locked_hydro_alt",
      }),
    ]);
  });

  it("marks only the Store-focused effect as focused", async () => {
    grid = await createGrid();
    grid.mode = "purchase";
    grid.tabbed = true;
    grid.focusedKey = "effect:nukeExplosion:locked_hydro";
    grid.requestUpdate();
    await grid.updateComplete;

    clickEffectType(grid, "nukeExplosion");
    await grid.updateComplete;
    clickNukeType(grid, "hydro");
    await grid.updateComplete;

    expect(effectCard(grid, "effect:nukeExplosion:locked_hydro")?.state).toBe(
      "focused",
    );
    expect(
      effectCard(grid, "effect:nukeExplosion:locked_hydro_alt")?.state,
    ).toBe("idle");
  });

  it("uses a two-column phone grid with responsive expansion", async () => {
    grid = await createGrid();
    grid.mode = "purchase";
    grid.tabbed = true;
    grid.requestUpdate();
    await grid.updateComplete;
    clickEffectType(grid, "nukeExplosion");
    await grid.updateComplete;
    clickNukeType(grid, "hydro");
    await grid.updateComplete;

    const items = grid.querySelector<HTMLElement>("[data-effects-items]")!;
    expect(items).toBeTruthy();
    expect(items.classList).toContain("grid");
    expect(items.classList).toContain("grid-cols-2");
    expect(items.classList).toContain("sm:grid-cols-3");
    expect(items.classList).toContain("lg:grid-cols-4");
    expect(items.className).not.toMatch(/\bflex\b|flex-wrap/);
  });
});
