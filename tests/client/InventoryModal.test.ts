import type { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import type { Cosmetics } from "../../src/core/CosmeticSchemas";
import { UserSettings } from "../../src/core/game/UserSettings";
import "../../src/client/InventoryModal";
import type { InventoryModal } from "../../src/client/InventoryModal";
import type { CosmeticButton } from "../../src/client/components/CosmeticButton";

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
    modal = document.createElement("inventory-modal") as InventoryModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    Object.assign(modal as unknown as Record<string, unknown>, {
      cosmetics: catalog as Cosmetics,
      userMeResponse: ownedUser as UserMeResponse,
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
  }, 30_000);

  it("clears crowns and effects through their None tiles", async () => {
    const settings = new UserSettings();
    settings.setSelectedCrownName("owned_crown");
    settings.setSelectedEffectName("transportShipTrail", "owned_wake");

    await showTab(modal, "crowns");
    tile(modal, "crown:none")!.onSelect!(tile(modal, "crown:none")!.resolved);
    expect(settings.getSelectedCrownName()).toBeNull();

    await showTab(modal, "effects");
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
});
