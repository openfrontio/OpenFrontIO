import type { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserMe } from "../../src/client/Api";
import { userAuth } from "../../src/client/Auth";
import { fetchCosmetics } from "../../src/client/Cosmetics";
import "../../src/client/InventoryModal";
import type { InventoryModal } from "../../src/client/InventoryModal";
import type { CosmeticButton } from "../../src/client/components/CosmeticButton";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import type { Cosmetics } from "../../src/core/CosmeticSchemas";
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

const catalog = {
  patterns: {},
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
      "skin:owned_skin",
      "flag:owned_flag",
      "crown:owned_crown",
      "effect:owned_wake",
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

function tile(modal: InventoryModal, key: string): CosmeticButton | undefined {
  return [...modal.querySelectorAll<CosmeticButton>("cosmetic-button")].find(
    (button) => button.resolved.key === key,
  );
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

  beforeEach(async () => {
    localStorage.clear();
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

  afterEach(() => modal.remove());

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
  });

  it("shows owned skins plus Default and equips without closing", async () => {
    await showTab(modal, "skins");
    expect(tile(modal, "pattern:default")).toBeDefined();
    expect(tile(modal, "skin:owned_skin")).toBeDefined();
    expect(tile(modal, "skin:locked_skin")).toBeUndefined();
    tile(modal, "skin:owned_skin")!.onSelect!(
      tile(modal, "skin:owned_skin")!.resolved,
    );
    expect(new UserSettings().getSelectedSkinName()).toBe("owned_skin");
    tile(modal, "pattern:default")!.onSelect!(
      tile(modal, "pattern:default")!.resolved,
    );
    expect(new UserSettings().getSelectedSkinName()).toBeNull();
    expect(modal.isConnected).toBe(true);
  });

  it("shows owned cosmetic flags and unrestricted country flags", async () => {
    await showTab(modal, "flags");
    expect(tile(modal, "flag:owned_flag")).toBeDefined();
    expect(tile(modal, "flag:locked_flag")).toBeUndefined();
    expect(tile(modal, "country:xx")).toBeDefined();
    expect(tile(modal, "country:us")).toBeDefined();
    expect(tile(modal, "country:German Empire")).toBeUndefined();
    tile(modal, "country:us")!.onSelect!(tile(modal, "country:us")!.resolved);
    expect(new UserSettings().getFlag()).toBe("country:us");
    tile(modal, "country:xx")!.onSelect!(tile(modal, "country:xx")!.resolved);
    expect(new UserSettings().getFlag()).toBeNull();
  }, 30_000);

  it("equips and clears crowns and effects through their tiles", async () => {
    const settings = new UserSettings();

    await showTab(modal, "crowns");
    tile(modal, "crown:owned_crown")!.onSelect!(
      tile(modal, "crown:owned_crown")!.resolved,
    );
    expect(settings.getSelectedCrownName()).toBe("owned_crown");
    tile(modal, "crown:none")!.onSelect!(tile(modal, "crown:none")!.resolved);
    expect(settings.getSelectedCrownName()).toBeNull();

    await showTab(modal, "effects");
    const owned = tile(modal, "effect:transportShipTrail:owned_wake")!;
    owned.onSelect!(owned.resolved);
    expect(settings.getSelectedEffectName("transportShipTrail")).toBe(
      "owned_wake",
    );
    const none = tile(modal, "effect:none:transportShipTrail")!;
    none.onSelect!(none.resolved);
    expect(settings.getSelectedEffectName("transportShipTrail")).toBeNull();
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
    expect(modal.querySelector("cosmetic-button")).toBeNull();
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
      expect(tile(modal, "skin:owned_skin")).toBeDefined();
      expect(tile(modal, "skin:locked_skin")).toBeUndefined();
    });
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
    expect(tile(modal, "pattern:default")).toBeDefined();
    expect(tile(modal, "skin:owned_skin")).toBeUndefined();
    await showTab(modal, "flags");
    expect(tile(modal, "country:xx")).toBeDefined();
    expect(tile(modal, "country:us")).toBeDefined();
    expect(tile(modal, "flag:owned_flag")).toBeUndefined();
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
    expect(tile(modal, "pattern:default")).toBeDefined();
    expect(modal.querySelector('[data-inventory-empty="skins"]')).toBeTruthy();

    await showTab(modal, "crowns");
    expect(tile(modal, "crown:none")).toBeDefined();
    expect(modal.querySelector('[data-inventory-empty="crowns"]')).toBeTruthy();

    await showTab(modal, "effects");
    expect(tile(modal, "effect:none:transportShipTrail")).toBeDefined();
    expect(
      modal.querySelector('[data-inventory-empty="effects"]'),
    ).toBeTruthy();

    await showTab(modal, "flags");
    expect(tile(modal, "country:us")).toBeDefined();
    expect(modal.querySelector('[data-inventory-empty="flags"]')).toBeNull();
  }, 30_000);
});
