import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  purchaseCosmetic,
  type ResolvedCosmetic,
} from "../../src/client/Cosmetics";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
  purchaseCosmeticPack: vi.fn(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn().mockResolvedValue(true),
  showInGameConfirm: vi.fn().mockResolvedValue(true),
}));

const { getUserMe, invalidateUserMe, purchaseCosmeticPack } =
  await import("../../src/client/Api");
const { showInGameAlert } = await import("../../src/client/InGameModal");

const translations = {
  "cosmetics.hard": "plutonium",
  "flags.pirate": "Jolly Roger",
  "inventory.selected_cosmetic_variant": "{name} ({variant})",
  "territory_patterns.color_palette.red": "Crimson",
  "store.login_required": "log in",
  "store.pack_already_owned": "already own {items}",
  "store.pack_debt": "debt {debt}",
  "store.pack_unavailable": "gone",
  "store.purchase_failed": "failed",
  "store.purchase_success": "bought {name}",
};

const starter: ResolvedCosmetic = {
  type: "cosmeticPack",
  cosmetic: {
    name: "starter",
    displayName: "Starter Pack",
    description: "",
    priceHard: 250,
    rarity: "common",
    items: [
      { type: "pattern", name: "camo" },
      { type: "flag", name: "pirate" },
    ],
  },
  colorPalette: null,
  relationship: "purchasable",
  key: "cosmeticPack:starter",
  packItems: [],
};

function userWithHard(hard: number) {
  return { player: { currency: { hard, soft: 0 }, flares: [] } } as never;
}

describe("purchaseCosmetic for a cosmetic pack", () => {
  let languageFixture: HTMLElement;
  let reloadMock: ReturnType<typeof vi.fn>;
  const originalLocation = window.location;

  beforeEach(() => {
    languageFixture = document.createElement("lang-selector");
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
    reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    });
  });

  afterEach(() => {
    languageFixture.remove();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.mocked(getUserMe).mockReset();
    vi.mocked(invalidateUserMe).mockReset();
    vi.mocked(purchaseCosmeticPack).mockReset();
    vi.mocked(showInGameAlert).mockClear();
  });

  it("buys the pack by slug for plutonium and reloads to show the grants", async () => {
    vi.mocked(getUserMe).mockResolvedValue(userWithHard(300));
    vi.mocked(purchaseCosmeticPack).mockResolvedValue({
      ok: true,
      data: {
        packName: "starter",
        currencyType: "hard",
        amount: "250",
        flareNames: ["pattern:camo", "flag:pirate"],
      },
    });

    await expect(purchaseCosmetic(starter, "hard")).resolves.toBeUndefined();

    expect(purchaseCosmeticPack).toHaveBeenCalledWith("starter");
    expect(showInGameAlert).toHaveBeenCalledWith("bought Starter Pack");
    expect(invalidateUserMe).toHaveBeenCalled();
    expect(reloadMock).toHaveBeenCalled();
  });

  it("reports the shortfall before any request when the balance is short", async () => {
    vi.mocked(getUserMe).mockResolvedValue(userWithHard(100));

    const result = await purchaseCosmetic(starter, "hard");

    expect(result).toEqual({
      currency: "plutonium",
      shortfall: 150,
      item: "Starter Pack",
      canTopUp: true,
    });
    expect(purchaseCosmeticPack).not.toHaveBeenCalled();
  });

  it("re-reads the balance when the server rejects for insufficient funds", async () => {
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(userWithHard(300))
      .mockResolvedValueOnce(userWithHard(40));
    vi.mocked(purchaseCosmeticPack).mockResolvedValue({
      ok: false,
      code: "insufficient_balance",
    });

    const result = await purchaseCosmetic(starter, "hard");

    expect(invalidateUserMe).toHaveBeenCalled();
    expect(result).toMatchObject({ shortfall: 210, item: "Starter Pack" });
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("treats 409 as stale ownership: names the items and refetches", async () => {
    vi.mocked(getUserMe).mockResolvedValue(userWithHard(300));
    vi.mocked(purchaseCosmeticPack).mockResolvedValue({
      ok: false,
      code: "already_owned",
      ownedFlareNames: ["flag:pirate", "pattern:camo:red"],
    });

    await purchaseCosmetic(starter, "hard");

    // Translated where a name exists, title-cased otherwise; a coloured
    // pattern names its colour.
    expect(showInGameAlert).toHaveBeenCalledWith(
      "already own Jolly Roger, Camo (Crimson)",
    );
    expect(invalidateUserMe).toHaveBeenCalled();
    expect(reloadMock).toHaveBeenCalled();
  });

  it("explains debt and stale listings without reloading", async () => {
    vi.mocked(getUserMe).mockResolvedValue(userWithHard(300));

    vi.mocked(purchaseCosmeticPack).mockResolvedValueOnce({
      ok: false,
      code: "debt",
      debt: "300",
    });
    await purchaseCosmetic(starter, "hard");
    expect(showInGameAlert).toHaveBeenLastCalledWith("debt 300");

    vi.mocked(purchaseCosmeticPack).mockResolvedValueOnce({
      ok: false,
      code: "unavailable",
    });
    await purchaseCosmetic(starter, "hard");
    expect(showInGameAlert).toHaveBeenLastCalledWith("gone");

    vi.mocked(purchaseCosmeticPack).mockResolvedValueOnce({
      ok: false,
      code: "failed",
    });
    await purchaseCosmetic(starter, "hard");
    expect(showInGameAlert).toHaveBeenLastCalledWith("failed");

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("requires a signed-in player and only sells packs for plutonium", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    await purchaseCosmetic(starter, "hard");
    expect(showInGameAlert).toHaveBeenCalledWith("log in");

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getUserMe).mockResolvedValue(userWithHard(300));
    await purchaseCosmetic(starter, "soft");
    expect(purchaseCosmeticPack).not.toHaveBeenCalled();
  });
});
