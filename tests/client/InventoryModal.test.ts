import type { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserMe } from "../../src/client/Api";
import { userAuth } from "../../src/client/Auth";
import { fetchCosmetics } from "../../src/client/Cosmetics";
import "../../src/client/InventoryModal";
import type { InventoryModal } from "../../src/client/InventoryModal";
import type { CosmeticCard } from "../../src/client/components/CosmeticCard";
import type { EffectsGrid } from "../../src/client/components/EffectsGrid";
import type { InventoryLoadoutBar } from "../../src/client/components/InventoryLoadoutBar";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import {
  EFFECT_TYPES,
  NUKE_EXPLOSION_TYPES,
  type Cosmetics,
  type EffectType,
  type NukeExplosionType,
} from "../../src/core/CosmeticSchemas";
import {
  CROWN_KEY,
  EFFECTS_KEY,
  FLAG_KEY,
  PATTERN_KEY,
  UserSettings,
} from "../../src/core/game/UserSettings";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
}));

vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  userAuth: vi.fn(),
}));

vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: vi.fn(),
}));

const common = {
  product: null,
  rarity: "common",
  affiliateCode: null,
} as const;

const trail = (name: string, effectType: string, color: string) => ({
  ...common,
  name,
  effectType,
  attributes: {
    type: "gradient",
    colors: [color],
    colorSize: 1,
    movementSpeed: 1,
  },
});

const explosion = (name: string, nukeType: string, color: string) => ({
  ...common,
  name,
  effectType: "nukeExplosion",
  attributes: {
    type: "shockwave",
    nukeType,
    colors: [color],
    size: 1,
    speed: 1,
    thickness: 1,
    transitionSpeed: 1,
  },
});

const catalog = {
  patterns: {
    stripes: {
      ...common,
      name: "stripes",
      pattern: "AAAAAA",
      colorPalettes: [
        { name: "red", isArchived: false },
        { name: "blue", isArchived: false },
      ],
    },
  },
  colorPalettes: {
    red: {
      name: "red",
      primaryColor: "#ef4444",
      secondaryColor: "#7f1d1d",
    },
    blue: {
      name: "blue",
      primaryColor: "#3b82f6",
      secondaryColor: "#1e3a8a",
    },
  },
  flags: {
    owned_flag: { ...common, name: "owned_flag", url: "/flags/owned.svg" },
    locked_flag: { ...common, name: "locked_flag", url: "/flags/locked.svg" },
  },
  crowns: {
    owned_crown: { ...common, name: "owned_crown", url: "/crowns/owned.svg" },
    locked_crown: {
      ...common,
      name: "locked_crown",
      url: "/crowns/locked.svg",
    },
  },
  skins: {
    owned_skin: { ...common, name: "owned_skin", url: "/skins/owned.png" },
    locked_skin: { ...common, name: "locked_skin", url: "/skins/locked.png" },
  },
  effects: {
    transportShipTrail: {
      owned_wake: trail("owned_wake", "transportShipTrail", "#ffffff"),
      owned_wake_alt: trail("owned_wake_alt", "transportShipTrail", "#00ffff"),
      locked_wake: {
        ...common,
        name: "locked_wake",
        effectType: "transportShipTrail",
        attributes: {
          type: "gradient",
          colors: ["#000000"],
          colorSize: 1,
          movementSpeed: 1,
        },
      },
    },
    nukeTrail: {
      owned_nuke_trail: trail("owned_nuke_trail", "nukeTrail", "#ff0000"),
    },
    nukeExplosion: {
      owned_atom: explosion("owned_atom", "atom", "#f97316"),
      owned_hydro: explosion("owned_hydro", "hydro", "#22d3ee"),
      owned_mirv: explosion("owned_mirv", "mirvWarhead", "#d946ef"),
    },
    structures: {
      owned_structures: trail("owned_structures", "structures", "#84cc16"),
    },
    warship: {
      owned_warship: trail("owned_warship", "warship", "#6366f1"),
    },
  },
} as unknown as Cosmetics;

const ownedUser = {
  user: {},
  player: {
    publicId: "inventory-test-player",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
    currency: { soft: 0, hard: 0 },
    flares: [
      "pattern:stripes",
      "pattern:stripes:red",
      "pattern:stripes:blue",
      "skin:owned_skin",
      "flag:owned_flag",
      "crown:owned_crown",
      "effect:owned_wake",
      "effect:owned_wake_alt",
      "effect:owned_nuke_trail",
      "effect:owned_atom",
      "effect:owned_hydro",
      "effect:owned_mirv",
      "effect:owned_structures",
      "effect:owned_warship",
    ],
  },
} as unknown as UserMeResponse;

const emptyCatalog = {
  ...catalog,
  patterns: {},
  flags: {},
  crowns: {},
  skins: {},
  effects: {},
} as unknown as Cosmetics;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function card(modal: InventoryModal, key: string): CosmeticCard | undefined {
  return [...modal.querySelectorAll<CosmeticCard>("cosmetic-card")].find(
    (candidate) =>
      candidate.resolved.key === key ||
      candidate.variants.some((variant) => variant.key === key),
  );
}

function loadout(modal: InventoryModal): InventoryLoadoutBar {
  return modal.querySelector("inventory-loadout-bar") as InventoryLoadoutBar;
}

async function activateCard(modal: InventoryModal, key: string) {
  const cosmeticCard = card(modal, key)!;
  cosmeticCard.onActivate!(
    cosmeticCard.variants.find((variant) => variant.key === key) ??
      cosmeticCard.resolved,
  );
  await modal.updateComplete;
}

async function activateVariant(modal: InventoryModal, key: string) {
  const cosmeticCard = card(modal, key)!;
  const variant = cosmeticCard.variants.find((item) => item.key === key)!;
  cosmeticCard.onVariantActivate!(variant);
  await modal.updateComplete;
}

async function showEffectSlot(
  modal: InventoryModal,
  effectType: EffectType,
  nukeType?: NukeExplosionType,
) {
  const grid = modal.querySelector("effects-grid") as EffectsGrid;
  grid
    .querySelectorAll<HTMLButtonElement>("button[class*='-mb-px']")
    [EFFECT_TYPES.indexOf(effectType)]!.click();
  await grid.updateComplete;
  if (nukeType) {
    grid
      .querySelectorAll<HTMLButtonElement>("button[class*='rounded-full']")
      [NUKE_EXPLOSION_TYPES.indexOf(nukeType)]!.click();
    await grid.updateComplete;
  }
  await modal.updateComplete;
  return grid;
}

async function showTab(
  modal: InventoryModal,
  tab: "skins" | "flags" | "crowns" | "effects",
) {
  modal.setActiveTab(tab);
  await modal.updateComplete;
  const effects = modal.querySelector("effects-grid");
  if (effects) await (effects as LitElement).updateComplete;
}

describe("InventoryModal", () => {
  let modal: InventoryModal;
  let languageFixture: HTMLElement;

  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;

  beforeEach(async () => {
    localStorage.clear();
    const settings = new UserSettings();
    settings.removeCached(PATTERN_KEY);
    settings.removeCached(FLAG_KEY);
    settings.removeCached(CROWN_KEY);
    settings.removeCached(EFFECTS_KEY);
    languageFixture = document.createElement("lang-selector");
    const translations = {
      "inventory.equipped": "Equipped",
      "inventory.loadout_category_label": "{category}: {summary}",
      "inventory.retry": "Retry",
      "inventory.showing_effects": "Effects equipped: {count}",
      "inventory.selected_cosmetic": "Selected {name}",
      "common.none": "No flag",
      "common.not_logged_in": "Not logged in",
      "main.store": "Store",
      "store.patterns": "Skins",
      "store.flags": "Flags",
      "store.crowns": "Crowns",
      "store.effects": "Effects",
      "territory_patterns.pattern.stripes": "Localized Stripes",
    };
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
    vi.mocked(fetchCosmetics).mockReset();
    vi.mocked(getUserMe).mockReset();
    vi.mocked(userAuth).mockReset();
    vi.mocked(getUserMe).mockResolvedValue(ownedUser);
    vi.mocked(userAuth).mockResolvedValue({ jwt: "test-token" } as never);
    modal = document.createElement("inventory-modal") as InventoryModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: catalog as Cosmetics,
      userMeResponse: ownedUser as UserMeResponse,
      ownershipState: "loaded",
      isLoading: false,
      loadFailed: false,
    });
    modal.requestUpdate();
    await modal.updateComplete;
  });

  afterEach(() => {
    modal.remove();
    languageFixture.remove();
  });

  it("has the four equip categories", () => {
    const config = (
      modal as unknown as { modalConfig(): { tabs: Array<{ key: string }> } }
    ).modalConfig();
    expect(config.tabs.map((tab) => tab.key)).toEqual([
      "skins",
      "flags",
      "crowns",
      "effects",
    ]);
    expect(
      modal
        .querySelector("o-modal")
        ?.shadowRoot?.querySelector('[role="tablist"]'),
    ).toBeNull();
  });

  it("keeps the auth-aware action in the modal header", async () => {
    let action = modal.querySelector<HTMLElement>(
      "[data-inventory-header-action]",
    )!;
    await (action as LitElement).updateComplete;
    expect(action.closest('[slot="header"]')).toBeTruthy();
    expect(action.textContent?.trim()).toBe("Store");

    Object.assign(modal as unknown as Record<string, unknown>, {
      userMeResponse: false,
      ownershipState: "guest",
    });
    modal.requestUpdate();
    await modal.updateComplete;

    action = modal.querySelector<HTMLElement>(
      "[data-inventory-header-action]",
    )!;
    await (action as LitElement).updateComplete;
    expect(action.closest('[slot="header"]')).toBeTruthy();
    expect(action.textContent?.trim()).toBe("Not logged in");
  });

  it("keeps loadout, card, and swatch synchronized", async () => {
    new UserSettings().setSelectedPatternName("pattern:stripes:red");
    await showTab(modal, "skins");

    expect(modal.querySelector('[data-loadout-category="skins"]')).toBeTruthy();
    expect(card(modal, "pattern:stripes:red")?.state).toBe("equipped");

    await activateVariant(modal, "pattern:stripes:blue");

    expect(localStorage.getItem(PATTERN_KEY)).toBe("pattern:stripes:blue");
    expect(card(modal, "pattern:stripes:blue")?.state).toBe("equipped");
  });

  it("uses the localized cosmetic name in the selection message", async () => {
    const onMessage = vi.fn();
    window.addEventListener("show-message", onMessage);
    try {
      await showTab(modal, "skins");
      await activateVariant(modal, "pattern:stripes:blue");

      const event = onMessage.mock.lastCall?.[0] as CustomEvent;
      expect(event.detail.message).toBe("Selected Localized Stripes");
    } finally {
      window.removeEventListener("show-message", onMessage);
    }
  });

  it("equips owned cards and clears each non-effect category", async () => {
    await showTab(modal, "skins");
    expect(card(modal, "pattern:default")).toBeDefined();
    expect(card(modal, "skin:owned_skin")).toBeDefined();
    expect(card(modal, "skin:locked_skin")).toBeUndefined();
    await activateCard(modal, "skin:owned_skin");
    expect(new UserSettings().getSelectedSkinName()).toBe("owned_skin");
    await activateCard(modal, "pattern:default");
    expect(new UserSettings().getSelectedSkinName()).toBeNull();
    expect(modal.isConnected).toBe(true);

    await showTab(modal, "flags");
    expect(card(modal, "flag:owned_flag")).toBeDefined();
    expect(card(modal, "flag:locked_flag")).toBeUndefined();
    expect(card(modal, "country:xx")).toBeDefined();
    expect(card(modal, "country:xx")?.querySelector("img")?.alt).toBe(
      "No flag",
    );
    expect(card(modal, "country:us")).toBeDefined();
    expect(card(modal, "country:German Empire")).toBeUndefined();
    await activateCard(modal, "flag:owned_flag");
    expect(new UserSettings().getFlag()).toBe("flag:owned_flag");
    await activateCard(modal, "country:us");
    expect(new UserSettings().getFlag()).toBe("country:us");
    await activateCard(modal, "country:xx");
    expect(new UserSettings().getFlag()).toBeNull();

    await showTab(modal, "crowns");
    await activateCard(modal, "crown:owned_crown");
    expect(new UserSettings().getSelectedCrownName()).toBe("owned_crown");
    await activateCard(modal, "crown:none");
    expect(new UserSettings().getSelectedCrownName()).toBeNull();
  }, 30_000);

  it("navigates all four loadout categories", async () => {
    for (const category of ["skins", "flags", "crowns", "effects"] as const) {
      loadout(modal)
        .querySelector<HTMLButtonElement>(
          `[data-loadout-category="${category}"]`,
        )!
        .click();
      await modal.updateComplete;
      expect(
        loadout(modal)
          .querySelector(`[data-loadout-category="${category}"]`)
          ?.getAttribute("aria-pressed"),
      ).toBe("true");
    }
  });

  it("clears every effect slot through its Default card", async () => {
    const settings = new UserSettings();
    const slots = [
      ["transportShipTrail", "transportShipTrail", "owned_wake"],
      ["nukeTrail", "nukeTrail", "owned_nuke_trail"],
      ["nukeExplosion", "atom", "owned_atom"],
      ["nukeExplosion", "hydro", "owned_hydro"],
      ["nukeExplosion", "mirvWarhead", "owned_mirv"],
      ["structures", "structures", "owned_structures"],
      ["warship", "warship", "owned_warship"],
    ] as const;

    await showTab(modal, "effects");
    for (const [effectType, slot, selectedName] of slots) {
      settings.setSelectedEffectName(slot, selectedName);
      await modal.updateComplete;
      const grid = await showEffectSlot(
        modal,
        effectType,
        effectType === "nukeExplosion" ? slot : undefined,
      );
      expect(card(modal, `effect:${effectType}:${selectedName}`)?.state).toBe(
        "equipped",
      );
      const none = [
        ...grid.querySelectorAll<CosmeticCard>("cosmetic-card"),
      ].find(
        (candidate) => candidate.resolved.key === `effect:none:${effectType}`,
      )!;
      none.onActivate!(none.resolved);
      expect(settings.getSelectedEffectName(slot)).toBeNull();
    }
  });

  it("equips an owned Effects card in every exact slot", async () => {
    const settings = new UserSettings();
    const slots = [
      ["transportShipTrail", "transportShipTrail", "owned_wake"],
      ["nukeTrail", "nukeTrail", "owned_nuke_trail"],
      ["nukeExplosion", "atom", "owned_atom"],
      ["nukeExplosion", "hydro", "owned_hydro"],
      ["nukeExplosion", "mirvWarhead", "owned_mirv"],
      ["structures", "structures", "owned_structures"],
      ["warship", "warship", "owned_warship"],
    ] as const;

    await showTab(modal, "effects");
    for (const [effectType, slot, selectedName] of slots) {
      await showEffectSlot(
        modal,
        effectType,
        effectType === "nukeExplosion" ? slot : undefined,
      );
      await activateCard(modal, `effect:${effectType}:${selectedName}`);

      expect(settings.getSelectedEffectName(slot)).toBe(selectedName);
      expect(card(modal, `effect:${effectType}:${selectedName}`)?.state).toBe(
        "equipped",
      );
    }
  });

  it("resynchronizes equipped Effects cards when the grid remounts", async () => {
    const settings = new UserSettings();
    settings.setSelectedEffectName("transportShipTrail", "owned_wake");
    settings.setSelectedEffectName("hydro", "owned_hydro");

    await showTab(modal, "effects");
    await showEffectSlot(modal, "nukeExplosion", "hydro");
    expect(card(modal, "effect:nukeExplosion:owned_hydro")?.state).toBe(
      "equipped",
    );

    await showTab(modal, "flags");
    await showTab(modal, "effects");

    expect(card(modal, "effect:transportShipTrail:owned_wake")?.state).toBe(
      "equipped",
    );
  });

  it("summarizes all equipped effect slots in one loadout category", async () => {
    const settings = new UserSettings();
    settings.setSelectedEffectName("transportShipTrail", "owned_wake");
    settings.setSelectedEffectName("nukeTrail", "owned_nuke_trail");
    settings.setSelectedEffectName("atom", "owned_atom");
    settings.setSelectedEffectName("hydro", "owned_hydro");
    settings.setSelectedEffectName("mirvWarhead", "owned_mirv");
    settings.setSelectedEffectName("structures", "owned_structures");
    settings.setSelectedEffectName("warship", "owned_warship");
    await modal.updateComplete;

    const entry = loadout(modal).entries.find(
      (candidate) => candidate.category === "effects",
    )!;
    expect(entry.items).toHaveLength(7);
    expect(entry.summary).toBe("Effects equipped: 7");
  });

  it("reacts to all settings keys changed outside Inventory", async () => {
    const settings = new UserSettings();

    await showTab(modal, "skins");
    settings.setSelectedPatternName("pattern:stripes:blue");
    await modal.updateComplete;
    expect(card(modal, "pattern:stripes:blue")?.state).toBe("equipped");

    await showTab(modal, "flags");
    settings.setFlag("flag:owned_flag");
    await modal.updateComplete;
    expect(card(modal, "flag:owned_flag")?.state).toBe("equipped");
    settings.setFlag("us");
    await modal.updateComplete;
    expect(localStorage.getItem(FLAG_KEY)).toBe("country:us");
    expect(card(modal, "country:us")?.state).toBe("equipped");

    await showTab(modal, "crowns");
    settings.setSelectedCrownName("owned_crown");
    await modal.updateComplete;
    expect(card(modal, "crown:owned_crown")?.state).toBe("equipped");

    await showTab(modal, "effects");
    settings.setSelectedEffectName("transportShipTrail", "owned_wake_alt");
    await modal.updateComplete;
    expect(card(modal, "effect:transportShipTrail:owned_wake_alt")?.state).toBe(
      "equipped",
    );
  });

  it("renders stable loading skeletons and responsive locker markers", async () => {
    Object.assign(modal as unknown as Record<string, unknown>, {
      ownershipState: "loading",
      isLoading: true,
    });
    modal.requestUpdate();
    await modal.updateComplete;

    for (const region of ["loadout", "grid"]) {
      expect(
        modal.querySelector(`[data-inventory-skeleton="${region}"]`),
      ).toBeTruthy();
    }

    Object.assign(modal as unknown as Record<string, unknown>, {
      ownershipState: "loaded",
      isLoading: false,
    });
    modal.requestUpdate();
    await modal.updateComplete;
    expect(loadout(modal).querySelector(".overflow-x-auto")).toBeTruthy();
    expect(modal.querySelector("[data-inventory-grid]")?.classList).toContain(
      "grid-cols-2",
    );
  });

  it("retries a failed load without changing the saved loadout", async () => {
    const settings = new UserSettings();
    settings.setSelectedPatternName("pattern:stripes:red");
    settings.setFlag("flag:owned_flag");
    settings.setSelectedCrownName("owned_crown");
    settings.setSelectedEffectName("transportShipTrail", "owned_wake");
    const saved = {
      pattern: localStorage.getItem(PATTERN_KEY),
      flag: localStorage.getItem(FLAG_KEY),
      crown: localStorage.getItem(CROWN_KEY),
      effects: localStorage.getItem(EFFECTS_KEY),
    };
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: null,
      ownershipState: "error",
      isLoading: false,
      loadFailed: true,
    });
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog);
    modal.requestUpdate();
    await modal.updateComplete;

    const retry = modal.querySelector<HTMLButtonElement>(
      "[data-inventory-retry]",
    )!;
    expect(retry.textContent).toContain("Retry");
    retry.click();
    expect(retry.disabled).toBe(true);
    retry.click();

    await vi.waitFor(() =>
      expect(modal.querySelector("inventory-loadout-bar")).toBeTruthy(),
    );
    expect(modal.querySelector("[data-inventory-state]")).toBeNull();
    expect(
      (modal as unknown as { ownershipState: string }).ownershipState,
    ).toBe("loaded");
    expect((modal as unknown as { isLoading: boolean }).isLoading).toBe(false);
    expect(fetchCosmetics).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PATTERN_KEY)).toBe(saved.pattern);
    expect(localStorage.getItem(FLAG_KEY)).toBe(saved.flag);
    expect(localStorage.getItem(CROWN_KEY)).toBe(saved.crown);
    expect(localStorage.getItem(EFFECTS_KEY)).toBe(saved.effects);
  });

  it("restores an enabled Retry button after a failed retry", async () => {
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: null,
      ownershipState: "error",
      isLoading: false,
      loadFailed: true,
    });
    vi.mocked(fetchCosmetics).mockResolvedValue(null);
    modal.requestUpdate();
    await modal.updateComplete;

    modal.querySelector<HTMLButtonElement>("[data-inventory-retry]")!.click();

    await vi.waitFor(() => {
      const retry = modal.querySelector<HTMLButtonElement>(
        "[data-inventory-retry]",
      );
      expect(retry).toBeTruthy();
      expect(retry?.disabled).toBe(false);
    });
    expect((modal as unknown as { isLoading: boolean }).isLoading).toBe(false);
  });

  it("shows a non-destructive failure state", async () => {
    const settings = new UserSettings();
    settings.setSelectedCrownName("owned_crown");
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: null,
      isLoading: false,
      loadFailed: true,
    });
    modal.requestUpdate();
    await modal.updateComplete;

    expect(modal.querySelector('[data-inventory-state="error"]')).toBeTruthy();
    expect(modal.querySelector("cosmetic-card")).toBeNull();
    expect(settings.getSelectedCrownName()).toBe("owned_crown");
  });

  it("updates owned cosmetics from the signed-in document event", async () => {
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: catalog as Cosmetics,
      userMeResponse: false,
      ownershipState: "guest",
      isLoading: false,
      loadFailed: false,
    });
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog);
    modal.requestUpdate();
    await modal.updateComplete;

    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: ownedUser }),
    );

    await vi.waitFor(() => {
      expect(card(modal, "skin:owned_skin")).toBeDefined();
      expect(card(modal, "skin:locked_skin")).toBeUndefined();
    });
  });

  it("keeps newer signed-in ownership while the initial load is in flight", async () => {
    const catalogRequest = deferred<Cosmetics | null>();
    const authRequest = deferred<false>();
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: null,
      userMeResponse: false,
      ownershipState: "loading",
      isLoading: false,
      loadFailed: false,
    });
    vi.mocked(fetchCosmetics).mockReturnValue(catalogRequest.promise);
    vi.mocked(userAuth).mockReturnValue(authRequest.promise);

    modal.open();
    await vi.waitFor(() => expect(userAuth).toHaveBeenCalledTimes(1));
    const signedInLoad = modal.onUserMe(ownedUser);
    catalogRequest.resolve(catalog);
    await signedInLoad;
    await modal.updateComplete;

    const stateBeforeStaleAuthSettles = {
      isLoading: (modal as unknown as { isLoading: boolean }).isLoading,
      hasOwnedSkin: card(modal, "skin:owned_skin") !== undefined,
    };
    authRequest.resolve(false);
    await Promise.resolve();
    await modal.updateComplete;

    expect(fetchCosmetics).toHaveBeenCalledTimes(1);
    expect(stateBeforeStaleAuthSettles).toEqual({
      isLoading: false,
      hasOwnedSkin: true,
    });
    expect(
      (modal as unknown as { userMeResponse: UserMeResponse | false })
        .userMeResponse,
    ).toBe(ownedUser);
    expect(
      (modal as unknown as { ownershipState: string }).ownershipState,
    ).toBe("loaded");
    expect(card(modal, "skin:owned_skin")).toBeDefined();
  });

  it("preserves the complete saved loadout when authenticated ownership refresh fails", async () => {
    const settings = new UserSettings();
    settings.setSelectedPatternName("skin:owned_skin");
    settings.setFlag("flag:owned_flag");
    settings.setSelectedCrownName("owned_crown");
    settings.setSelectedEffectName("transportShipTrail", "owned_wake");
    const saved = {
      pattern: localStorage.getItem(PATTERN_KEY),
      flag: localStorage.getItem(FLAG_KEY),
      crown: localStorage.getItem(CROWN_KEY),
      effects: localStorage.getItem(EFFECTS_KEY),
    };
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog);
    vi.mocked(getUserMe).mockResolvedValue(false);

    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: false }),
    );

    await vi.waitFor(() => {
      expect(
        modal.querySelector('[data-inventory-state="error"]'),
      ).toBeTruthy();
    });
    expect(localStorage.getItem(PATTERN_KEY)).toBe(saved.pattern);
    expect(localStorage.getItem(FLAG_KEY)).toBe(saved.flag);
    expect(localStorage.getItem(CROWN_KEY)).toBe(saved.crown);
    expect(localStorage.getItem(EFFECTS_KEY)).toBe(saved.effects);
  });

  it("shows guest defaults and country flags without inferring catalog ownership", async () => {
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: null,
      userMeResponse: false,
      ownershipState: "loading",
      isLoading: true,
      loadFailed: false,
    });
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog);
    vi.mocked(userAuth).mockResolvedValue(false);

    modal.open();

    await vi.waitFor(() => {
      expect(
        (modal as unknown as { ownershipState: string }).ownershipState,
      ).toBe("guest");
    });
    expect(card(modal, "pattern:default")).toBeDefined();
    expect(card(modal, "skin:owned_skin")).toBeUndefined();
    await showTab(modal, "flags");
    expect(card(modal, "country:xx")).toBeDefined();
    expect(card(modal, "country:us")).toBeDefined();
    expect(card(modal, "flag:owned_flag")).toBeUndefined();
    expect(vi.mocked(getUserMe)).not.toHaveBeenCalled();
  }, 30_000);

  it("shows localized empty states while retaining Default and None tiles", async () => {
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: emptyCatalog,
      userMeResponse: false,
      ownershipState: "guest",
      isLoading: false,
      loadFailed: false,
    });
    modal.requestUpdate();

    await showTab(modal, "skins");
    expect(card(modal, "pattern:default")).toBeDefined();
    expect(modal.querySelector('[data-inventory-empty="skins"]')).toBeTruthy();

    await showTab(modal, "crowns");
    expect(card(modal, "crown:none")).toBeDefined();
    expect(modal.querySelector('[data-inventory-empty="crowns"]')).toBeTruthy();

    await showTab(modal, "effects");
    expect(card(modal, "effect:none:transportShipTrail")).toBeDefined();
    expect(
      modal.querySelector('[data-inventory-empty="effects"]'),
    ).toBeTruthy();

    await showTab(modal, "flags");
    expect(card(modal, "country:us")).toBeDefined();
    expect(modal.querySelector('[data-inventory-empty="flags"]')).toBeNull();
  }, 30_000);
});
