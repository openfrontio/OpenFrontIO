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
import { UserSettings } from "../../src/core/game/UserSettings";

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
        product: { priceId: "locked-hydro" },
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
        product: { priceId: "locked-hydro-alt" },
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

  afterEach(() => {
    grid?.remove();
    grid = undefined;
    localStorage.clear();
    vi.mocked(purchaseCosmetic).mockReset();
  });

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

  it("marks the stored effect equipped and clears its exact slot with Default", async () => {
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
    expect(effectCard(grid, "effect:none:nukeExplosion")?.state).toBe("idle");

    const defaultCard = effectCard(grid, "effect:none:nukeExplosion")!;
    defaultCard.onActivate!(defaultCard.resolved);
    expect(settings.getSelectedEffectName("hydro")).toBeNull();
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
});
