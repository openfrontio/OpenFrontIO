import {
  StorePlacementSchema,
  type UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getUserMe } from "../../src/client/Api";
import { userAuth } from "../../src/client/Auth";
import type { InventoryItemTile } from "../../src/client/components/inventory/InventoryItemTile";
import { itemStateOf } from "../../src/client/components/inventory/ItemState";
import {
  PENDING_EQUIP_KEY,
  PENDING_EQUIP_TTL_MS,
  rememberPendingEquip,
} from "../../src/client/components/inventory/PendingEquip";
import type { PurchaseButton } from "../../src/client/components/PurchaseButton";
import {
  fetchCosmetics,
  invalidateCosmetics,
  purchaseCosmetic,
  purchaseReloading,
} from "../../src/client/Cosmetics";
import { COSMETICS_CHANGED } from "../../src/client/Experiments";
import "../../src/client/InventoryModal";
import type { InventoryModal } from "../../src/client/InventoryModal";
import {
  CROWN_KEY,
  EFFECTS_KEY,
  FLAG_KEY,
  LOADOUTS_KEY,
  PATTERN_KEY,
  UserSettings,
} from "../../src/client/UserSettings";

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
  purchaseCosmetic: vi.fn(),
  purchaseReloading: vi.fn(() => false),
  invalidateCosmetics: vi.fn(),
}));

const base = { product: null, affiliateCode: null } as const;
const LATER = () => new Date(Date.now() + 3_600_000).toISOString();

const trail = (name: string, effectType: string, rarity = "common") => ({
  ...base,
  rarity,
  name,
  effectType,
  attributes: {
    type: "gradient",
    colors: ["#ffffff"],
    colorSize: 1,
    movementSpeed: 1,
  },
});

function makeCatalog(): Cosmetics {
  return {
    patterns: {
      hexgrid: {
        ...base,
        rarity: "rare",
        name: "hexgrid",
        pattern: "AAAAAA",
        artist: "Ada",
        aiDisclosed: false,
      },
      plain: { ...base, rarity: "common", name: "plain", pattern: "AAAAAA" },
      tiger: {
        ...base,
        rarity: "epic",
        name: "tiger",
        pattern: "AAAAAA",
      },
    },
    colorPalettes: {},
    flags: {
      owned_flag: {
        ...base,
        rarity: "common",
        name: "owned_flag",
        url: "/flags/owned.svg",
      },
    },
    crowns: {
      gold_crown: {
        ...base,
        rarity: "rare",
        name: "gold_crown",
        url: "/crowns/gold.svg",
      },
      sale_crown: {
        ...base,
        rarity: "epic",
        name: "sale_crown",
        url: "/crowns/sale.svg",
        artist: "Grace",
        aiDisclosed: true,
        priceHard: 300,
        listPriceHard: 400,
        priceSoft: 1800,
        listPriceSoft: 2400,
        promotion: {
          id: "p1",
          name: "Winter sale",
          percentOff: 25,
          endsAt: LATER(),
        },
      },
      season_crown: {
        ...base,
        rarity: "legendary",
        name: "season_crown",
        url: "/crowns/season.svg",
        unlockSource: { kind: "season", label: "Season 1 · free tier 20" },
      },
    },
    skins: {
      camo: {
        ...base,
        rarity: "uncommon",
        name: "camo",
        url: "/skins/camo.png",
        priceSoft: 4000,
      },
    },
    effects: {
      transportShipTrail: {
        smoke: trail("smoke", "transportShipTrail", "uncommon"),
        sparks: trail("sparks", "transportShipTrail", "rare"),
        comet: { ...trail("comet", "transportShipTrail"), priceHard: 200 },
      },
      nukeTrail: { ember: trail("ember", "nukeTrail") },
    },
  } as unknown as Cosmetics;
}

function makeUser(flares: string[]): UserMeResponse {
  return {
    user: {},
    player: {
      publicId: "in-game-test-player",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
      currency: { soft: 5000, hard: 5000 },
      flares,
    },
  } as unknown as UserMeResponse;
}

const OWNED = [
  "pattern:hexgrid",
  "pattern:plain",
  "pattern:tiger",
  "flag:owned_flag",
  "crown:gold_crown",
  "effect:smoke",
  "effect:sparks",
];

async function settle(modal: InventoryModal) {
  for (let i = 0; i < 4; i++) {
    await modal.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function tiles(root: ParentNode): InventoryItemTile[] {
  return [...root.querySelectorAll<InventoryItemTile>("inventory-item-tile")];
}

function tile(root: ParentNode, key: string): InventoryItemTile {
  const found = tiles(root).find(
    (candidate) =>
      candidate.resolved.key === key ||
      candidate.variants.some((variant) => variant.key === key),
  );
  if (!found) throw new Error(`no tile ${key}`);
  return found;
}

async function setFilter(modal: InventoryModal, filter: string) {
  modal
    .querySelector<HTMLButtonElement>(`[data-inventory-filter="${filter}"]`)!
    .click();
  await settle(modal);
}

async function clickTile(modal: InventoryModal, key: string) {
  tile(modal, key)
    .querySelector<HTMLButtonElement>("[data-tile-main]")!
    .click();
  await settle(modal);
}

describe("Inventory In game tab", () => {
  let modal: InventoryModal;
  let messages: string[];
  const onMessage = (event: Event) =>
    messages.push((event as CustomEvent<{ message: string }>).detail.message);

  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;

  // Long grids (1,008 country flags) render a page at a time behind an
  // IntersectionObserver, as in the browser; jsdom has none.
  beforeAll(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterAll(() => vi.unstubAllGlobals());

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    const settings = new UserSettings();
    for (const key of [
      PATTERN_KEY,
      FLAG_KEY,
      CROWN_KEY,
      EFFECTS_KEY,
      LOADOUTS_KEY,
    ]) {
      settings.removeCached(key);
    }
    messages = [];
    window.addEventListener("show-message", onMessage);
    vi.mocked(fetchCosmetics).mockResolvedValue(makeCatalog());
    vi.mocked(userAuth).mockResolvedValue({
      jwt: "token",
      claims: {},
    } as Awaited<ReturnType<typeof userAuth>>);
    vi.mocked(getUserMe).mockResolvedValue(makeUser(OWNED));
    vi.mocked(purchaseCosmetic).mockReset();
    vi.mocked(purchaseReloading).mockReset().mockReturnValue(false);
    modal = document.createElement("inventory-modal") as InventoryModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
  });

  afterEach(() => {
    window.removeEventListener("show-message", onMessage);
    modal.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function open(
    tab = "skins",
    user: UserMeResponse | false = makeUser(OWNED),
  ) {
    if (user === false) {
      vi.mocked(userAuth).mockResolvedValue(false);
    } else {
      vi.mocked(getUserMe).mockResolvedValue(user);
    }
    modal.open({ tab });
    await settle(modal);
  }

  describe("tabs and routes", () => {
    it("opens In game on the requested category", async () => {
      await open("crowns");
      expect(
        modal
          .querySelector('[data-inventory-top-tab="ingame"]')!
          .getAttribute("aria-selected"),
      ).toBe("true");
      expect(
        modal.querySelector("[data-inventory-grid='crowns']"),
      ).not.toBeNull();
      expect(modal.querySelector("inventory-card-tab")).toBeNull();
    });

    it("tab=card opens the Player card tab", async () => {
      await open("card");
      expect(
        modal
          .querySelector('[data-inventory-top-tab="card"]')!
          .getAttribute("aria-selected"),
      ).toBe("true");
      expect(modal.querySelector("inventory-card-tab")).not.toBeNull();
      expect(modal.querySelector("[data-inventory-grid]")).toBeNull();
    });

    it("a sign-out hides the old account's card tab while it checks", async () => {
      await open("card");
      expect(modal.querySelector("inventory-card-tab")).not.toBeNull();
      let finishAuth!: (value: false) => void;
      vi.mocked(userAuth).mockImplementation(
        () =>
          new Promise((resolve) => {
            finishAuth = resolve;
          }),
      );
      document.dispatchEvent(
        new CustomEvent("userMeResponse", { detail: false }),
      );
      await modal.updateComplete;
      // userAuth's round trip is still out: the loading state, not the old
      // account's card.
      expect(modal.querySelector("inventory-card-tab")).toBeNull();
      expect(modal.querySelector("[data-inventory-skeleton]")).not.toBeNull();
      finishAuth(false);
      await settle(modal);
      expect(modal.querySelector("inventory-card-tab")).toBeNull();
    });

    it("the first load that throws still shows the error view", async () => {
      vi.mocked(fetchCosmetics).mockRejectedValue(new Error("offline"));
      await open("card");
      expect(
        modal.querySelector("[data-inventory-state='error']"),
      ).not.toBeNull();
    });

    it("the first load's failed catalogue fetch still shows the error view", async () => {
      vi.mocked(fetchCosmetics).mockResolvedValue(null);
      await open("card");
      expect(
        modal.querySelector("[data-inventory-state='error']"),
      ).not.toBeNull();
    });

    it("switches between the two tabs and back to the last category", async () => {
      await open("crowns");
      modal
        .querySelector<HTMLButtonElement>('[data-inventory-top-tab="card"]')!
        .click();
      await settle(modal);
      expect(modal.querySelector("inventory-card-tab")).not.toBeNull();
      modal
        .querySelector<HTMLButtonElement>('[data-inventory-top-tab="ingame"]')!
        .click();
      await settle(modal);
      expect(
        modal.querySelector("[data-inventory-grid='crowns']"),
      ).not.toBeNull();
    });

    it("the Player card link in Your look opens the card tab", async () => {
      await open("skins");
      modal
        .querySelector<HTMLButtonElement>("[data-your-look-card-link]")!
        .click();
      await settle(modal);
      expect(modal.querySelector("inventory-card-tab")).not.toBeNull();
    });
  });

  describe("grid", () => {
    it("defaults to the Owned filter", async () => {
      await open("skins");
      expect(
        modal
          .querySelector('[data-inventory-filter="owned"]')!
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(tiles(modal).map((t) => t.resolved.key)).not.toContain(
        "skin:camo",
      );
    });

    it("sorts equipped first, then owned, then by rarity", async () => {
      new UserSettings().setSelectedPatternName("pattern:plain");
      await open("skins");
      await setFilter(modal, "all");
      expect(tiles(modal).map((t) => t.resolved.key)).toEqual([
        "pattern:plain",
        "pattern:tiger",
        "pattern:hexgrid",
        "pattern:default",
        "skin:camo",
      ]);
    });

    it("marks the equipped tile with text and a corner check, not colour alone", async () => {
      new UserSettings().setSelectedPatternName("pattern:hexgrid");
      await open("skins");
      const equipped = tile(modal, "pattern:hexgrid");
      expect(equipped.state).toBe("equipped");
      expect(
        equipped.querySelector("[data-tile-footer]")!.textContent,
      ).toContain("inventory.equipped");
      expect(equipped.querySelector("[data-tile-check]")).not.toBeNull();
      expect(
        tile(modal, "pattern:tiger").querySelector("[data-tile-footer]")!
          .textContent,
      ).toContain("inventory.state_owned");
    });

    it("counts owned items as tiles, colours included in one", async () => {
      const catalog = makeCatalog() as unknown as {
        patterns: Record<string, Record<string, unknown>>;
        colorPalettes: Record<string, unknown>;
      };
      catalog.patterns.plain.colorPalettes = [
        { name: "red", isArchived: false },
        { name: "blue", isArchived: false },
      ];
      catalog.colorPalettes = {
        red: { name: "red", primaryColor: "#f00", secondaryColor: "#000" },
        blue: { name: "blue", primaryColor: "#00f", secondaryColor: "#000" },
      };
      vi.mocked(fetchCosmetics).mockResolvedValue(
        catalog as unknown as Cosmetics,
      );
      await open(
        "skins",
        makeUser([...OWNED, "pattern:plain:red", "pattern:plain:blue"]),
      );
      const tilesWithItems = tiles(modal).filter(
        (t) => t.resolved.cosmetic !== null,
      );
      expect(
        modal.querySelector("[data-inventory-owned-count]")!.textContent,
      ).toContain("inventory.owned_count");
      expect(
        (modal as unknown as { ownedCount(c: string): number }).ownedCount(
          "skins",
        ),
      ).toBe(tilesWithItems.length);
      // One swatch per colour, the default look included; each a full-size
      // touch target.
      const swatches = [
        ...tile(modal, "pattern:plain").querySelectorAll<HTMLElement>(
          "[data-variant-key]",
        ),
      ];
      expect(
        swatches.map((swatch) => swatch.dataset.variantKey).sort(),
      ).toEqual(["pattern:plain", "pattern:plain:blue", "pattern:plain:red"]);
      for (const swatch of swatches) {
        expect(swatch.className).toMatch(/(^| )h-11( |$)/);
        expect(swatch.className).toMatch(/(^| )w-11( |$)/);
      }
    });

    it("a pattern with one colour still offers its default look", async () => {
      const catalog = makeCatalog() as unknown as {
        patterns: Record<string, Record<string, unknown>>;
        colorPalettes: Record<string, unknown>;
      };
      catalog.patterns.plain.colorPalettes = [
        { name: "red", isArchived: false },
      ];
      catalog.colorPalettes = {
        red: { name: "red", primaryColor: "#f00", secondaryColor: "#000" },
      };
      vi.mocked(fetchCosmetics).mockResolvedValue(
        catalog as unknown as Cosmetics,
      );
      await open("skins", makeUser([...OWNED, "pattern:plain:red"]));
      const plainTile = tile(modal, "pattern:plain");
      const fallback = plainTile.querySelector<HTMLButtonElement>(
        '[data-variant-key="pattern:plain"]',
      );
      expect(fallback).not.toBeNull();
      expect(fallback!.getAttribute("aria-label")).toBe(
        "territory_patterns.pattern.default",
      );
      expect(
        plainTile.querySelector('[data-variant-key="pattern:plain:red"]'),
      ).not.toBeNull();
    });

    it("on phones, says what was equipped in its own status line", async () => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("max-width"),
      }));
      try {
        await open("crowns");
        await clickTile(modal, "crown:gold_crown");
        expect(
          modal.querySelector("[data-inventory-status]")!.textContent,
        ).toContain("inventory.item_equipped");
        expect(messages).toEqual([]);
        // Reopened within the 2 s: no stale message.
        modal.close();
        await settle(modal);
        modal.open({ tab: "crowns" });
        await settle(modal);
        expect(
          modal.querySelector("[data-inventory-status]")!.textContent!.trim(),
        ).toBe("");
      } finally {
        vi.unstubAllGlobals();
        vi.stubGlobal(
          "IntersectionObserver",
          class {
            observe() {}
            unobserve() {}
            disconnect() {}
          },
        );
      }
    });

    it("shows the rarity word at the top of each tile", async () => {
      await open("skins");
      expect(
        tile(modal, "pattern:tiger").querySelector("[data-tile-rarity]")!
          .textContent,
      ).toMatch(/\S/);
    });

    it("an earned-only tile shows how to unlock it and never a price", async () => {
      await open("crowns");
      await setFilter(modal, "all");
      const earned = tile(modal, "crown:season_crown");
      expect(earned.state).toBe("earned");
      expect(earned.querySelector("[data-tile-unlock]")!.textContent).toContain(
        "Season 1 · free tier 20",
      );
      expect(earned.querySelector("[data-tile-price]")).toBeNull();
      expect(earned.querySelector("purchase-button")).toBeNull();
    });

    it("a for-sale tile shows the sale price, struck list price and sale name", async () => {
      await open("crowns");
      await setFilter(modal, "all");
      const sale = tile(modal, "crown:sale_crown");
      expect(sale.state).toBe("forSale");
      const hard = sale.querySelector('[data-tile-price="hard"]')!;
      expect(hard.textContent).toContain("300");
      expect(
        hard.querySelector("[data-tile-list-price]")!.textContent,
      ).toContain("400");
      const soft = sale.querySelector('[data-tile-price="soft"]')!;
      // In the runtime's locale ("1.800" under de-DE), as the tile shows it.
      expect(soft.textContent).toContain((1800).toLocaleString());
      expect(
        sale.querySelector("[data-tile-sale-label]")!.textContent,
      ).toContain("Winter sale");
    });

    it("clicking an owned tile equips it at once with a message and no save bar", async () => {
      await open("crowns");
      await clickTile(modal, "crown:gold_crown");
      expect(new UserSettings().getSelectedCrownName()).toBe("gold_crown");
      expect(tile(modal, "crown:gold_crown").state).toBe("equipped");
      expect(messages).toContain("inventory.item_equipped");
      expect(modal.querySelector("[data-inventory-save-bar]")).toBeNull();
    });

    it("never shows an item the account doesn't own as equipped", async () => {
      // Equipped on this device, but not owned by this account.
      new UserSettings().setSelectedCrownName("sale_crown");
      await open("crowns");
      expect(modal.querySelector("[data-inventory-equipped-chip]")).toBeNull();
      await setFilter(modal, "all");
      expect(tile(modal, "crown:sale_crown").state).toBe("forSale");
    });

    it("offers Use default instead of Unequip", async () => {
      new UserSettings().setSelectedCrownName("gold_crown");
      await open("crowns");
      expect(modal.querySelector("[data-inventory-unequip]")).toBeNull();
      const useDefault = modal.querySelector<HTMLButtonElement>(
        "[data-inventory-use-default]",
      )!;
      expect(useDefault.textContent).toContain("inventory.use_default");
      useDefault.click();
      await settle(modal);
      expect(new UserSettings().getSelectedCrownName()).toBeNull();
    });

    it("ends each grid with the Store tile", async () => {
      await open("skins");
      const grid = modal.querySelector("[data-inventory-grid='skins']")!;
      expect(
        grid.lastElementChild!.hasAttribute("data-inventory-store-tile"),
      ).toBe(true);
    });
  });

  describe("loadout dropdown", () => {
    it("lists loadouts in a dropdown that equips the chosen one", async () => {
      const settings = new UserSettings();
      settings.setSelectedCrownName("gold_crown");
      settings.addLoadout(); // 01: gold crown
      settings.setActiveLoadout(null);
      settings.setSelectedCrownName(undefined);
      settings.addLoadout(); // 02: no crown, now active
      await open("crowns");
      const select = modal.querySelector<HTMLSelectElement>(
        "[data-loadout-select]",
      )!;
      expect(
        [...select.querySelectorAll("option[data-loadout-slot]")].map(
          (o) => (o as HTMLOptionElement).value,
        ),
      ).toEqual(["01", "02"]);
      expect(select.value).toBe("02");
      select.value = "01";
      select.dispatchEvent(new Event("change"));
      await settle(modal);
      expect(new UserSettings().getSelectedCrownName()).toBe("gold_crown");
      expect(new UserSettings().getActiveLoadout()).toBe("01");
      expect(
        modal.querySelector("[data-inventory-loadout-area]")!.textContent,
      ).toContain("inventory.loadout_on_device");
    });

    it("choosing the active loadout again keeps the unsaved look", async () => {
      const settings = new UserSettings();
      settings.addLoadout(); // 01, active, nothing equipped
      await open("crowns");
      await clickTile(modal, "crown:gold_crown");
      expect(modal.querySelector("[data-loadout-edited]")).not.toBeNull();
      // The native select fires no change for the option already chosen;
      // the component's callback is what a choice reaches.
      modal
        .querySelector<HTMLElement & { onSelect: (name: string) => void }>(
          "inventory-loadout-select",
        )!
        .onSelect("01");
      await settle(modal);
      expect(new UserSettings().getSelectedCrownName()).toBe("gold_crown");
      expect(modal.querySelector("[data-loadout-edited]")).not.toBeNull();
    });

    it("a loadout saved with a legacy country flag isn't edited once the flag migrates", async () => {
      const settings = new UserSettings();
      settings.setFlag("us"); // saved before the country: prefix
      settings.addLoadout(); // 01 holds "us"
      expect(settings.getLoadout("01")?.flag).toBe("us");
      expect(settings.getFlag()).toBe("country:us"); // migrates the live key
      await open("crowns");
      expect(modal.querySelector("[data-loadout-edited]")).toBeNull();
    });

    it("shows <name> · edited with Update when the look differs", async () => {
      const settings = new UserSettings();
      settings.addLoadout(); // 01, active, nothing equipped
      await open("crowns");
      expect(modal.querySelector("[data-loadout-edited]")).toBeNull();
      // Equipping from the grid changes the look, not the loadout.
      await setFilter(modal, "owned");
      await clickTile(modal, "crown:gold_crown");
      expect(new UserSettings().getSelectedCrownName()).toBe("gold_crown");
      expect(new UserSettings().getLoadout("01")?.crown).toBeNull();
      expect(modal.querySelector("[data-loadout-edited]")).not.toBeNull();
      expect(
        modal.querySelector("[data-loadout-edited]")!.textContent,
      ).toContain("inventory.loadout_edited");
      modal.querySelector<HTMLButtonElement>("[data-loadout-update]")!.click();
      await settle(modal);
      expect(new UserSettings().getLoadout("01")?.crown).toBe("gold_crown");
      expect(modal.querySelector("[data-loadout-edited]")).toBeNull();
    });
  });

  describe("states", () => {
    it("signed out: sign-in prompt, and country flags stay usable marked Free", async () => {
      await open("flags", false);
      expect(modal.querySelector("[data-inventory-sign-in]")).not.toBeNull();
      const search = modal.querySelector<HTMLInputElement>(
        "[data-inventory-search]",
      )!;
      search.value = "gb";
      search.dispatchEvent(new Event("input"));
      await settle(modal);
      const gb = tile(modal, "country:gb");
      expect(gb.querySelector("[data-tile-footer]")!.textContent).toContain(
        "inventory.free",
      );
      await clickTile(modal, "country:gb");
      expect(new UserSettings().getFlag()).toBe("country:gb");
    });

    it("loading: skeleton tiles", async () => {
      vi.mocked(fetchCosmetics).mockReturnValue(new Promise(() => {}));
      modal.open({ tab: "skins" });
      await modal.updateComplete;
      expect(
        modal.querySelectorAll("[data-inventory-skeleton-tile]").length,
      ).toBeGreaterThan(0);
    });

    it("owns nothing: the default shows equipped, with a note and a Store link", async () => {
      await open("skins", makeUser([]));
      expect(tile(modal, "pattern:default").state).toBe("equipped");
      const empty = modal.querySelector("[data-inventory-empty='nothing']")!;
      expect(empty.textContent).toContain("inventory.no_owned_skins");
      expect(
        empty.querySelector("[data-inventory-browse-store]"),
      ).not.toBeNull();
    });

    it("empty filter: No owned crowns, with Show all and Browse the Store", async () => {
      await open("crowns", makeUser([]));
      const empty = modal.querySelector("[data-inventory-empty='filter']")!;
      expect(empty.textContent).toContain("inventory.empty_owned_crowns");
      expect(
        empty.querySelector("[data-inventory-browse-store]"),
      ).not.toBeNull();
      empty
        .querySelector<HTMLButtonElement>("[data-inventory-show-all]")!
        .click();
      await settle(modal);
      expect(
        modal
          .querySelector('[data-inventory-filter="all"]')!
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(tiles(modal).length).toBeGreaterThan(0);
    });
  });

  describe("effects list", () => {
    it("lists every effect slot with the item in use, owned count and Change", async () => {
      new UserSettings().setSelectedEffectName("transportShipTrail", "smoke");
      await open("effects");
      const rows = [
        ...modal.querySelectorAll<HTMLElement>("[data-effect-row]"),
      ];
      expect(rows.map((row) => row.dataset.effectRow)).toEqual([
        "transportShipTrail",
        "nukeTrail",
        "atom",
        "hydro",
        "mirvWarhead",
        "structures",
        "warship",
        "train",
        "railroad",
      ]);
      const ship = rows[0];
      expect(
        ship.querySelector("[data-effect-row-name]")!.textContent,
      ).toContain("inventory.effect_slot.transportShipTrail");
      expect(ship.querySelector("[data-effect-row-item]")!.textContent).toMatch(
        /smoke/i,
      );
      expect(
        ship.querySelector("[data-effect-row-owned]")!.textContent,
      ).toContain("inventory.owned_count");
      expect(ship.querySelector("[data-effect-row-change]")).not.toBeNull();
      expect(
        rows[1].querySelector("[data-effect-row-item]")!.textContent,
      ).toContain("inventory.effect_default");
    });

    it("each Change and Close button names its effect type", async () => {
      const lang = document.createElement("lang-selector");
      const translations = {
        "inventory.effect_change": "Change",
        "common.close": "Close",
        "inventory.effect_change_slot": "Change {slot}",
        "inventory.effect_close_slot": "Close {slot}",
        "inventory.effect_slot.transportShipTrail": "Ship trail",
      };
      Object.assign(lang, {
        translations,
        defaultTranslations: translations,
        currentLang: "en",
      });
      document.body.appendChild(lang);
      try {
        await open("effects");
        const button = () =>
          modal.querySelector<HTMLButtonElement>(
            '[data-effect-row="transportShipTrail"] [data-effect-row-change]',
          )!;
        // The visible word stays; the name says which type it opens.
        expect(button().textContent!.trim()).toBe("Change");
        expect(button().getAttribute("aria-label")).toBe("Change Ship trail");
        button().click();
        await settle(modal);
        expect(button().textContent!.trim()).toBe("Close");
        expect(button().getAttribute("aria-label")).toBe("Close Ship trail");
      } finally {
        lang.remove();
      }
    });

    it("Change opens that type's grid inline, and equipping works there", async () => {
      await open("effects");
      expect(modal.querySelector("[data-effect-row-grid]")).toBeNull();
      modal
        .querySelector<HTMLButtonElement>(
          '[data-effect-row="transportShipTrail"] [data-effect-row-change]',
        )!
        .click();
      await settle(modal);
      const grid = modal.querySelector(
        '[data-effect-row="transportShipTrail"] [data-effect-row-grid]',
      )!;
      expect(grid).not.toBeNull();
      expect(tiles(grid).map((t) => t.resolved.key)).toEqual([
        "effect:transportShipTrail:sparks",
        "effect:transportShipTrail:smoke",
      ]);
      await clickTile(modal, "effect:transportShipTrail:sparks");
      expect(
        new UserSettings().getSelectedEffectName("transportShipTrail"),
      ).toBe("sparks");
    });

    it("Your look counts custom and default effect slots", async () => {
      new UserSettings().setSelectedEffectName("transportShipTrail", "smoke");
      await open("skins");
      const effects = modal.querySelector('[data-your-look-slot="effects"]')!;
      const summary = effects.querySelector("[data-your-look-value]")!;
      expect(summary.textContent).toContain("inventory.effects_summary");
      // Said once: the swatches are hidden from screen readers.
      expect(
        effects.textContent!.split("inventory.effects_summary").length - 1,
      ).toBe(1);
      expect(
        modal.querySelectorAll("[data-your-look-effect-swatch]").length,
      ).toBe(9);
      expect(
        modal.querySelectorAll('[data-your-look-effect-swatch="default"]')
          .length,
      ).toBe(8);
    });
  });

  describe("unowned preview and buy", () => {
    it("clicking an unowned item opens the buy popup with shown prices, equipping nothing", async () => {
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      const dialog = modal.querySelector("inventory-buy-dialog")!;
      expect(dialog).not.toBeNull();
      const button = dialog.querySelector<PurchaseButton>("purchase-button")!;
      expect(button.priceHard).toBe(300);
      expect(button.listPriceHard).toBe(400);
      expect(button.priceSoft).toBe(1800);
      expect(button.listPriceSoft).toBe(2400);
      expect(button.promotion?.name).toBe("Winter sale");
      expect(new UserSettings().getSelectedCrownName()).toBeNull();
    });

    it("sends the confirmed price, and after a price_changed reload the retry sends the new one", async () => {
      // Confirms the popup's purchase button, as a player would.
      const buyHard = async () => {
        const button = modal.querySelector<PurchaseButton>(
          "inventory-buy-dialog purchase-button",
        )!;
        button.requestCurrencyPurchase("hard");
        await settle(modal);
        button
          .querySelector("confirm-dialog")!
          .dispatchEvent(new CustomEvent("confirm"));
        await settle(modal);
      };
      // The first try gets 409 price_changed, whose reload announces the
      // catalogue now in use (the group's price, 350).
      const raised = makeCatalog();
      (raised.crowns!.sale_crown as { priceHard: number }).priceHard = 350;
      vi.mocked(purchaseCosmetic).mockImplementationOnce(async () => {
        document.dispatchEvent(
          new CustomEvent(COSMETICS_CHANGED, { detail: raised }),
        );
        return undefined;
      });
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");

      await buyHard();
      expect(vi.mocked(purchaseCosmetic).mock.calls[0]?.[3]).toBe(300);
      expect(
        modal.querySelector<PurchaseButton>(
          "inventory-buy-dialog purchase-button",
        )!.priceHard,
      ).toBe(350);

      await buyHard();
      expect(purchaseCosmetic).toHaveBeenCalledTimes(2);
      expect(vi.mocked(purchaseCosmetic).mock.calls[1]?.[3]).toBe(350);
    });

    it("a catalogue refresh that lands after a catalogue change keeps the newer one", async () => {
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      // A refresh (the sale-end timer, or reopening) goes out...
      let landOld!: (c: Cosmetics) => void;
      vi.mocked(fetchCosmetics).mockReturnValueOnce(
        new Promise<Cosmetics>((resolve) => (landOld = resolve)),
      );
      const refresh = (
        modal as unknown as { refreshCatalog(): Promise<void> }
      ).refreshCatalog();
      // ...then the group's catalogue is announced. (The real cache is left
      // alone: it can lag behind what was announced.)
      const raised = makeCatalog();
      (raised.crowns!.sale_crown as { priceHard: number }).priceHard = 350;
      document.dispatchEvent(
        new CustomEvent(COSMETICS_CHANGED, { detail: raised }),
      );
      // ...and the older answer lands last.
      landOld(makeCatalog());
      await refresh;
      await settle(modal);
      expect(
        modal.querySelector<PurchaseButton>(
          "inventory-buy-dialog purchase-button",
        )!.priceHard,
      ).toBe(350);
    });

    it("a catalogue announced during the first load isn't replaced by the plain one", async () => {
      // The first load's catalogue request is out...
      let landPlain!: (c: Cosmetics) => void;
      vi.mocked(fetchCosmetics).mockReturnValueOnce(
        new Promise<Cosmetics>((resolve) => (landPlain = resolve)),
      );
      modal.open({ tab: "crowns" });
      await settle(modal);
      // ...the group's catalogue is announced...
      const raised = makeCatalog();
      (raised.crowns!.sale_crown as { priceHard: number }).priceHard = 350;
      document.dispatchEvent(
        new CustomEvent(COSMETICS_CHANGED, { detail: raised }),
      );
      // ...and the plain answer lands last.
      landPlain(makeCatalog());
      await settle(modal);
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      expect(
        modal.querySelector<PurchaseButton>(
          "inventory-buy-dialog purchase-button",
        )!.priceHard,
      ).toBe(350);
    });

    it("closes the buy popup when a new catalogue no longer sells the item", async () => {
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      expect(modal.querySelector("inventory-buy-dialog")).not.toBeNull();
      const without = makeCatalog();
      delete without.crowns!.sale_crown;
      document.dispatchEvent(
        new CustomEvent(COSMETICS_CHANGED, { detail: without }),
      );
      await settle(modal);
      expect(modal.querySelector("inventory-buy-dialog")).toBeNull();
    });

    it("after a purchase the popup offers Equip now, which equips it", async () => {
      // A successful purchase reloads the page; the profile can land first.
      vi.mocked(purchaseReloading).mockReturnValue(true);
      vi.mocked(purchaseCosmetic).mockImplementation(async () => {
        document.dispatchEvent(
          new CustomEvent("userMeResponse", {
            detail: makeUser([...OWNED, "crown:sale_crown"]),
          }),
        );
        return undefined;
      });
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      const button = modal.querySelector<PurchaseButton>(
        "inventory-buy-dialog purchase-button",
      )!;
      await button.onPurchaseHard!();
      await settle(modal);
      expect(purchaseCosmetic).toHaveBeenCalledWith(
        expect.objectContaining({ key: "crown:sale_crown" }),
        "hard",
        { kind: "inventory", subTab: "crowns" },
        // Called straight, with no confirm box: no shown amount.
        undefined,
      );
      // The infra API's schema for this kind: these sub-tabs, required.
      for (const subTab of ["skins", "flags", "crowns", "effects", "card"]) {
        expect(
          StorePlacementSchema.safeParse({ kind: "inventory", subTab }).success,
        ).toBe(true);
      }
      expect(
        StorePlacementSchema.safeParse({ kind: "inventory" }).success,
      ).toBe(false);
      const equipNow = modal.querySelector<HTMLButtonElement>(
        "inventory-buy-dialog [data-buy-equip-now]",
      )!;
      expect(equipNow).not.toBeNull();
      equipNow.click();
      await settle(modal);
      expect(new UserSettings().getSelectedCrownName()).toBe("sale_crown");
      expect(modal.querySelector("inventory-buy-dialog")).toBeNull();
    });

    it("Equip now leaves focus on the bought item's tile after the re-sort", async () => {
      vi.mocked(purchaseCosmetic).mockImplementation(async () => {
        document.dispatchEvent(
          new CustomEvent("userMeResponse", {
            detail: makeUser([...OWNED, "crown:sale_crown"]),
          }),
        );
        return undefined;
      });
      vi.mocked(purchaseReloading).mockReturnValue(true);
      await open("crowns");
      await setFilter(modal, "all");
      const main = tile(modal, "crown:sale_crown").querySelector<HTMLElement>(
        "[data-tile-main]",
      )!;
      main.focus();
      main.click();
      await settle(modal);
      await modal.querySelector<PurchaseButton>(
        "inventory-buy-dialog purchase-button",
      )!.onPurchaseHard!();
      await settle(modal);
      modal
        .querySelector<HTMLButtonElement>(
          "inventory-buy-dialog [data-buy-equip-now]",
        )!
        .click();
      await settle(modal);
      expect(new UserSettings().getSelectedCrownName()).toBe("sale_crown");
      const focused = document.activeElement!.closest<InventoryItemTile>(
        "inventory-item-tile",
      );
      expect(focused).not.toBeNull();
      expect(focused!.resolved.key).toBe("crown:sale_crown");
    });

    it("offers Equip now after the purchase reloaded the page", async () => {
      rememberPendingEquip("in-game-test-player", "crown:sale_crown");
      await open("crowns", makeUser([...OWNED, "crown:sale_crown"]));
      const equipNow = modal.querySelector<HTMLButtonElement>(
        "inventory-buy-dialog [data-buy-equip-now]",
      );
      expect(equipNow).not.toBeNull();
      expect(sessionStorage.getItem(PENDING_EQUIP_KEY)).toBeNull();
    });

    it("a closed Inventory leaves a remembered purchase for when it opens", async () => {
      rememberPendingEquip("in-game-test-player", "crown:sale_crown");
      // The Inventory is mounted but closed (prefetched) when a profile
      // broadcast says the item is owned, e.g. after buying it in the Store.
      document.dispatchEvent(
        new CustomEvent("userMeResponse", {
          detail: makeUser([...OWNED, "crown:sale_crown"]),
        }),
      );
      await settle(modal);
      expect(modal.querySelector("inventory-buy-dialog")).toBeNull();
      expect(sessionStorage.getItem(PENDING_EQUIP_KEY)).not.toBeNull();
      // Its keys aren't taken over: Tab and Escape reach the page.
      const tab = new KeyboardEvent("keydown", {
        key: "Tab",
        cancelable: true,
      });
      window.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(false);

      modal.open({ tab: "crowns" });
      await settle(modal);
      expect(
        modal.querySelector("inventory-buy-dialog [data-buy-equip-now]"),
      ).not.toBeNull();
      expect(sessionStorage.getItem(PENDING_EQUIP_KEY)).toBeNull();
    });

    it("a purchase that fails without a reload forgets the item", async () => {
      vi.mocked(purchaseCosmetic).mockResolvedValue(undefined);
      vi.mocked(purchaseReloading).mockReturnValue(false);
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      await modal.querySelector<PurchaseButton>(
        "inventory-buy-dialog purchase-button",
      )!.onPurchaseHard!();
      expect(purchaseCosmetic).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(PENDING_EQUIP_KEY)).toBeNull();
    });

    it("a purchase that throws forgets the item", async () => {
      vi.mocked(purchaseCosmetic).mockRejectedValue(new Error("network"));
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      const purchase = modal as unknown as {
        purchase(item: unknown, method: "hard"): Promise<unknown>;
        buying: unknown;
      };
      await expect(purchase.purchase(purchase.buying, "hard")).rejects.toThrow(
        "network",
      );
      expect(sessionStorage.getItem(PENDING_EQUIP_KEY)).toBeNull();
    });

    it("an earlier purchase that fails keeps a later one's item", async () => {
      let failA!: (error: Error) => void;
      let finishB!: () => void;
      vi.mocked(purchaseCosmetic)
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              failA = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishB = () => resolve(undefined);
            }),
        );
      await open("crowns");
      const purchase = modal as unknown as {
        purchase(item: { key: string }, method: "hard"): Promise<unknown>;
      };
      const a = purchase.purchase({ key: "crown:sale_crown" }, "hard");
      const b = purchase.purchase({ key: "crown:other_crown" }, "hard");
      failA(new Error("network"));
      await expect(a).rejects.toThrow("network");
      expect(JSON.parse(sessionStorage.getItem(PENDING_EQUIP_KEY)!).key).toBe(
        "crown:other_crown",
      );
      vi.mocked(purchaseReloading).mockReturnValue(true);
      finishB();
      await b;
      expect(JSON.parse(sessionStorage.getItem(PENDING_EQUIP_KEY)!).key).toBe(
        "crown:other_crown",
      );
    });

    it("an earlier purchase of the same item that fails keeps the later one's record", async () => {
      let failA!: (error: Error) => void;
      let finishB!: () => void;
      vi.mocked(purchaseCosmetic)
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              failA = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishB = () => resolve(undefined);
            }),
        );
      await open("crowns");
      const purchase = modal as unknown as {
        purchase(
          item: { key: string },
          method: "hard" | "soft",
        ): Promise<unknown>;
      };
      const a = purchase.purchase({ key: "crown:sale_crown" }, "hard");
      const b = purchase.purchase({ key: "crown:sale_crown" }, "soft");
      failA(new Error("network"));
      await expect(a).rejects.toThrow("network");
      expect(sessionStorage.getItem(PENDING_EQUIP_KEY)).not.toBeNull();
      vi.mocked(purchaseReloading).mockReturnValue(true);
      finishB();
      await b;
      expect(JSON.parse(sessionStorage.getItem(PENDING_EQUIP_KEY)!).key).toBe(
        "crown:sale_crown",
      );
    });

    it("a purchase that reloads the page keeps the item for Equip now", async () => {
      vi.mocked(purchaseCosmetic).mockResolvedValue(undefined);
      vi.mocked(purchaseReloading).mockReturnValue(true);
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      await modal.querySelector<PurchaseButton>(
        "inventory-buy-dialog purchase-button",
      )!.onPurchaseHard!();
      expect(sessionStorage.getItem(PENDING_EQUIP_KEY)).not.toBeNull();
    });

    it("keeps the record while the item isn't owned yet, until it lapses", async () => {
      rememberPendingEquip("in-game-test-player", "crown:sale_crown");
      await open("crowns");
      // A profile read before the purchase landed: nothing offered, kept.
      expect(modal.querySelector("inventory-buy-dialog")).toBeNull();
      expect(sessionStorage.getItem(PENDING_EQUIP_KEY)).not.toBeNull();
      document.dispatchEvent(
        new CustomEvent("userMeResponse", {
          detail: makeUser([...OWNED, "crown:sale_crown"]),
        }),
      );
      await settle(modal);
      expect(
        modal.querySelector("inventory-buy-dialog [data-buy-equip-now]"),
      ).not.toBeNull();
      expect(sessionStorage.getItem(PENDING_EQUIP_KEY)).toBeNull();
    });

    it("drops a remembered purchase once it lapses", async () => {
      rememberPendingEquip(
        "in-game-test-player",
        "crown:sale_crown",
        Date.now() - PENDING_EQUIP_TTL_MS - 1,
      );
      await open("crowns", makeUser([...OWNED, "crown:sale_crown"]));
      expect(modal.querySelector("inventory-buy-dialog")).toBeNull();
      expect(sessionStorage.getItem(PENDING_EQUIP_KEY)).toBeNull();
    });

    it("a buy in flight stays busy after closing and reopening the dialog", async () => {
      let finish!: () => void;
      vi.mocked(purchaseCosmetic).mockImplementation(
        () =>
          new Promise<undefined>((resolve) => {
            finish = () => resolve(undefined);
          }),
      );
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      const first = modal.querySelector<PurchaseButton>(
        "inventory-buy-dialog purchase-button",
      )!;
      first.requestCurrencyPurchase("hard");
      await first.updateComplete;
      first
        .querySelector("confirm-dialog")!
        .dispatchEvent(new CustomEvent("confirm"));
      await settle(modal);
      expect(purchaseCosmetic).toHaveBeenCalledTimes(1);

      modal
        .querySelector<HTMLButtonElement>(
          "inventory-buy-dialog [data-buy-close]",
        )!
        .click();
      await settle(modal);
      expect(modal.querySelector("inventory-buy-dialog")).toBeNull();
      await clickTile(modal, "crown:sale_crown");
      const again = modal.querySelector<PurchaseButton>(
        "inventory-buy-dialog purchase-button",
      )!;
      expect(
        again.querySelector<HTMLButtonElement>(".purchase-sparkle-btn-hard")!
          .disabled,
      ).toBe(true);
      again.requestCurrencyPurchase("hard");
      await again.updateComplete;
      expect(again.querySelector("confirm-dialog")).toBeNull();
      expect(purchaseCosmetic).toHaveBeenCalledTimes(1);

      finish();
      await settle(modal);
      expect(
        again.querySelector<HTMLButtonElement>(".purchase-sparkle-btn-hard")!
          .disabled,
      ).toBe(false);
    });

    it("an earned item shows how to unlock it and no buy", async () => {
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:season_crown");
      const dialog = modal.querySelector("inventory-buy-dialog")!;
      expect(dialog.querySelector("[data-buy-unlock]")!.textContent).toContain(
        "Season 1 · free tier 20",
      );
      expect(dialog.querySelector("purchase-button")).toBeNull();
    });

    it("signed out: clicking an unowned item opens the sign-in prompt instead", async () => {
      const showPage = vi.fn();
      (window as unknown as { showPage: unknown }).showPage = showPage;
      await open("crowns", false);
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      expect(modal.querySelector("inventory-buy-dialog")).toBeNull();
      expect(showPage).toHaveBeenCalledWith("page-account");
    });
  });

  describe("prices stay current (Review Focus 3)", () => {
    afterEach(() => vi.useRealTimers());

    it("tiles and the buy dialog switch to list prices when a sale ends while open", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const catalog = makeCatalog() as unknown as {
        crowns: Record<string, { promotion: { endsAt: string } }>;
      };
      catalog.crowns.sale_crown.promotion.endsAt = new Date(
        Date.now() + 5_000,
      ).toISOString();
      vi.mocked(fetchCosmetics).mockResolvedValue(
        catalog as unknown as Cosmetics,
      );
      await open("crowns");
      await setFilter(modal, "all");
      expect(
        tile(modal, "crown:sale_crown").querySelector("[data-tile-sale-label]"),
      ).not.toBeNull();
      await clickTile(modal, "crown:sale_crown");
      const dialog = modal.querySelector("inventory-buy-dialog")!;
      expect(dialog.querySelector("[data-buy-sale-label]")).not.toBeNull();

      vi.advanceTimersByTime(5_100);
      await settle(modal);

      const sale = tile(modal, "crown:sale_crown");
      expect(sale.querySelector("[data-tile-sale-label]")).toBeNull();
      expect(sale.querySelector("[data-tile-list-price]")).toBeNull();
      expect(
        sale.querySelector('[data-tile-price="hard"]')!.textContent,
      ).toContain("400");
      const after = modal.querySelector("inventory-buy-dialog")!;
      expect(after.querySelector("[data-buy-sale-label]")).toBeNull();
      expect(
        after.querySelector<PurchaseButton>("purchase-button")!.priceHard,
      ).toBe(400);
    });

    it("a sale that starts after the first load shows on reopen", async () => {
      const noSale = makeCatalog() as unknown as {
        crowns: Record<string, Record<string, unknown>>;
      };
      const crown = noSale.crowns.sale_crown;
      crown.priceHard = 400;
      crown.priceSoft = 2400;
      delete crown.listPriceHard;
      delete crown.listPriceSoft;
      delete crown.promotion;
      vi.mocked(fetchCosmetics).mockResolvedValue(
        noSale as unknown as Cosmetics,
      );
      await open("crowns");
      await setFilter(modal, "all");
      expect(
        tile(modal, "crown:sale_crown").querySelector("[data-tile-sale-label]"),
      ).toBeNull();

      modal.close();
      await settle(modal);
      vi.mocked(fetchCosmetics).mockResolvedValue(makeCatalog());
      modal.open({ tab: "crowns" });
      await settle(modal);
      await setFilter(modal, "all");
      expect(
        tile(modal, "crown:sale_crown").querySelector("[data-tile-sale-label]")!
          .textContent,
      ).toContain("Winter sale");
    });
  });

  describe("catalogue refetch for an ended sale", () => {
    afterEach(() => vi.useRealTimers());

    function endingCatalog(endsAt: number): Cosmetics {
      const catalog = makeCatalog() as unknown as {
        crowns: Record<string, { promotion: { endsAt: string } }>;
      };
      catalog.crowns.sale_crown.promotion.endsAt = new Date(
        endsAt,
      ).toISOString();
      return catalog as unknown as Cosmetics;
    }

    it("refetches once for a sale that ended after the catalogue was fetched", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.mocked(fetchCosmetics).mockResolvedValue(
        endingCatalog(Date.now() + 5_000),
      );
      await open("crowns");
      modal.close();
      await settle(modal);
      vi.advanceTimersByTime(6_000);
      vi.mocked(invalidateCosmetics).mockClear();

      modal.open({ tab: "crowns" });
      await settle(modal);
      expect(invalidateCosmetics).toHaveBeenCalledTimes(1);

      // The CDN still serves the ended sale: no refetch on every open.
      modal.close();
      await settle(modal);
      modal.open({ tab: "crowns" });
      await settle(modal);
      expect(invalidateCosmetics).toHaveBeenCalledTimes(1);
    });

    it("doesn't refetch for a sale that had ended before the catalogue was fetched", async () => {
      vi.mocked(fetchCosmetics).mockResolvedValue(
        endingCatalog(Date.now() - 60_000),
      );
      await open("crowns");
      vi.mocked(invalidateCosmetics).mockClear();
      modal.close();
      await settle(modal);
      modal.open({ tab: "crowns" });
      await settle(modal);
      expect(invalidateCosmetics).not.toHaveBeenCalled();
    });
  });

  describe("accessibility, focus and previews", () => {
    it("focus stays put when the dialog's item refreshes while focus is elsewhere", async () => {
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      outside.focus();
      // A refetched catalogue gives the dialog a new item object.
      vi.mocked(fetchCosmetics).mockResolvedValue(makeCatalog());
      await (
        modal as unknown as { refreshCatalog(): Promise<void> }
      ).refreshCatalog();
      await settle(modal);
      expect(document.activeElement).toBe(outside);
    });

    function describedBy(el: Element): string {
      return (el.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
    }

    it("a tile's button is described by its rarity, state and price", async () => {
      new UserSettings().setSelectedPatternName("pattern:hexgrid");
      await open("crowns");
      await setFilter(modal, "all");
      const owned = tile(modal, "crown:gold_crown").querySelector(
        "[data-tile-main]",
      )!;
      expect(owned.getAttribute("aria-label")).toBeTruthy();
      expect(describedBy(owned)).toContain("inventory.state_owned");
      const sale = tile(modal, "crown:sale_crown").querySelector(
        "[data-tile-main]",
      )!;
      const description = describedBy(sale);
      expect(description).toContain("300");
      expect(description).toContain("400");
      expect(description).toContain("Winter sale");
    });

    it("the buy dialog takes focus, traps Tab and gives focus back to the tile", async () => {
      await open("crowns");
      await setFilter(modal, "all");
      const main = tile(modal, "crown:sale_crown").querySelector<HTMLElement>(
        "[data-tile-main]",
      )!;
      main.focus();
      main.click();
      await settle(modal);
      const dialog = modal.querySelector("inventory-buy-dialog")!;
      expect(document.activeElement).toBe(
        dialog.querySelector("[data-buy-close]"),
      );

      const buttons = [
        ...dialog.querySelectorAll<HTMLElement>("[data-buy-panel] button"),
      ].filter((b) => !(b as HTMLButtonElement).disabled);
      buttons[buttons.length - 1].focus();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
      expect(document.activeElement).toBe(buttons[0]);
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }),
      );
      expect(document.activeElement).toBe(buttons[buttons.length - 1]);

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await settle(modal);
      expect(modal.querySelector("inventory-buy-dialog")).toBeNull();
      expect(document.activeElement).toBe(main);
    });

    it("an alert over the dialog keeps Tab and gets Escape", async () => {
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      // The purchase flow's alerts (showInGameAlert) go on document.body.
      const alert = document.createElement("confirm-dialog");
      let cancelled = 0;
      alert.addEventListener("cancel", () => cancelled++);
      document.body.appendChild(alert);
      (document.activeElement as HTMLElement | null)?.blur();

      const tab = new KeyboardEvent("keydown", {
        key: "Tab",
        cancelable: true,
      });
      window.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(false);
      expect(
        modal
          .querySelector("inventory-buy-dialog")!
          .contains(document.activeElement),
      ).toBe(false);

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await settle(modal);
      expect(cancelled).toBe(1);
      expect(modal.querySelector("inventory-buy-dialog")).not.toBeNull();
      alert.remove();
    });

    it("Escape leaves the dialog open while the purchase confirm is open", async () => {
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      const button = modal.querySelector<PurchaseButton>(
        "inventory-buy-dialog purchase-button",
      )!;
      button.requestCurrencyPurchase("hard");
      await button.updateComplete;
      expect(button.querySelector("confirm-dialog")).not.toBeNull();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await settle(modal);
      expect((modal as unknown as { isModalOpen: boolean }).isModalOpen).toBe(
        true,
      );
      expect(modal.querySelector("inventory-buy-dialog")).not.toBeNull();
      // That Escape cancelled the confirm; the next closes the dialog.
      expect(button.querySelector("confirm-dialog")).toBeNull();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await settle(modal);
      expect(modal.querySelector("inventory-buy-dialog")).toBeNull();
      expect((modal as unknown as { isModalOpen: boolean }).isModalOpen).toBe(
        true,
      );
    });

    it("owned tiles keep the 3D preview and the artist credits", async () => {
      await open("skins");
      const hex = tile(modal, "pattern:hexgrid");
      const info = hex.querySelector("cosmetic-info") as unknown as {
        artist?: string;
        aiDisclosed?: boolean;
      };
      expect(info.artist).toBe("Ada");
      expect(info.aiDisclosed).toBe(false);
      expect(
        hex.querySelector(
          "[data-tile-main] cosmetic-info, [data-tile-main] button",
        ),
      ).toBeNull();
      hex
        .querySelector<HTMLButtonElement>("cosmetic-preview-bubble button")!
        .click();
      await settle(modal);
      expect(modal.querySelector("cosmetic-preview-modal")).not.toBeNull();
      expect(new UserSettings().getSelectedPatternName(null)).toBeNull();
    });

    it("the buy dialog shows the artist and AI disclosure", async () => {
      await open("crowns");
      await setFilter(modal, "all");
      await clickTile(modal, "crown:sale_crown");
      const dialog = modal.querySelector("inventory-buy-dialog")!;
      expect(dialog.querySelector("[data-buy-artist]")!.textContent).toContain(
        "Grace",
      );
      expect(dialog.querySelector("[data-buy-ai]")).not.toBeNull();
    });
  });

  describe("phone", () => {
    it("keeps text at 11px or more and touch targets at least 44px", async () => {
      await open("effects");
      // The item artwork (<cosmetic-preview>) is shared with the Store and
      // not part of this check.
      const copy = modal.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("cosmetic-preview").forEach((el) => el.remove());
      const html = copy.innerHTML;
      expect(html).not.toMatch(/text-\[(?:[0-9]|10)px\]/);
      for (const selector of [
        "[data-inventory-filter]",
        "[data-effect-row-change]",
        "[data-inventory-top-tab]",
        "[data-loadout-category]",
        "[data-effect-chip]",
      ]) {
        const elements = modal.querySelectorAll(selector);
        expect(elements.length, selector).toBeGreaterThan(0);
        for (const el of elements) {
          expect(el.className, selector).toMatch(
            /min-h-11|h-11|min-h-12|h-12|min-h-24/,
          );
        }
      }
    });

    it("shows the slot strip and effect types as chips", async () => {
      await open("effects");
      expect(modal.querySelectorAll("[data-loadout-category]").length).toBe(4);
      expect(modal.querySelector("[data-effect-chips]")).not.toBeNull();
    });
  });
});

describe("itemStateOf", () => {
  const resolved = (relationship: string, extra: object = {}) =>
    ({
      type: "crown",
      cosmetic: { name: "x", rarity: "common", ...extra },
      colorPalette: null,
      relationship,
      key: "crown:x",
    }) as never;

  it("maps ownership and equip state", () => {
    expect(itemStateOf(resolved("owned"), true)).toBe("equipped");
    expect(itemStateOf(resolved("owned"), false)).toBe("owned");
    expect(itemStateOf(resolved("purchasable", { priceHard: 1 }), false)).toBe(
      "forSale",
    );
    expect(
      itemStateOf(
        resolved("blocked", { unlockSource: { kind: "quest", label: "Q" } }),
        false,
      ),
    ).toBe("earned");
    expect(itemStateOf(resolved("blocked"), false)).toBeNull();
  });
});
