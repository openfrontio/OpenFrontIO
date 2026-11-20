import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
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
import { saveCardLoadout } from "../../src/client/CardLoadoutApi";
import { fetchCosmetics } from "../../src/client/Cosmetics";
import "../../src/client/InventoryModal";
import type { InventoryModal } from "../../src/client/InventoryModal";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
}));
vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  userAuth: vi.fn(),
}));
vi.mock("../../src/client/CardLoadoutApi", () => ({
  saveCardLoadout: vi.fn(),
}));
vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: vi.fn(),
  invalidateCosmetics: vi.fn(),
}));

const item = { product: null, rarity: "common", affiliateCode: null };
function catalog(): Cosmetics {
  return {
    patterns: {},
    flags: {},
    playerCards: {
      standard: { ...item, name: "standard", priceHard: 300, priceSoft: 30000 },
    },
    cardTrackers: Object.fromEntries(
      ["wins", "games_played", "nukes_launched", "best_elo"].map((s) => [
        s,
        { ...item, name: s, stat: s, priceSoft: 400 },
      ]),
    ),
    cardBackgrounds: {
      bg_pacific: { ...item, name: "bg_pacific", url: "/bg/pacific.webp" },
      bg_storm: {
        ...item,
        name: "bg_storm",
        url: "/bg/storm.webp",
        priceSoft: 2400,
      },
    },
    cardTitles: {},
    taunts: {},
  } as unknown as Cosmetics;
}

const OWNER = [
  "playerCard:standard",
  "cardBackground:bg_pacific",
  "cardTracker:wins",
  "cardTracker:games_played",
  "cardTracker:nukes_launched",
  "cardTracker:best_elo",
];
function owner(flares: string[] = OWNER): UserMeResponse {
  return {
    user: {},
    player: {
      publicId: "guard-test-player",
      username: "iamlewis",
      flares,
      currency: { soft: 5000, hard: 5000 },
      card: {
        background: "bg_pacific",
        trackers: [
          { stat: "wins", value: 312 },
          { stat: "nukes_launched", value: 4880 },
          { stat: "best_elo", value: 1612 },
        ],
      },
    },
  } as unknown as UserMeResponse;
}

async function settle(modal: InventoryModal) {
  for (let i = 0; i < 5; i++) {
    await modal.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("Inventory: unsaved card changes guard", () => {
  let modal: InventoryModal;
  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;
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
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog());
    vi.mocked(userAuth).mockResolvedValue({
      jwt: "token",
      claims: {},
    } as Awaited<ReturnType<typeof userAuth>>);
    vi.mocked(getUserMe).mockResolvedValue(owner());
    vi.mocked(saveCardLoadout).mockReset();
    modal = document.createElement("inventory-modal") as InventoryModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
  });
  afterEach(() => {
    modal.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const q = <T extends HTMLElement = HTMLElement>(s: string) =>
    modal.querySelector<T>(s);
  async function click(selector: string) {
    q(selector)!.click();
    await settle(modal);
  }
  /** Opens the card tab and changes tracker 3 to Games played. */
  async function openWithChange() {
    modal.open({ tab: "card" });
    await settle(modal);
    await click("[data-card-slot-row='tracker:2'] [data-card-row-open]");
    await click("[data-card-pick='cardTracker:games_played'] [data-tile-main]");
  }
  const onCardTab = () =>
    q("[data-inventory-top-tab='card']")!.getAttribute("aria-selected") ===
    "true";
  const back = () =>
    modal.querySelector<HTMLButtonElement>("[slot='header'] button")!;

  it("no changes: switching to In game goes straight there", async () => {
    modal.open({ tab: "card" });
    await settle(modal);
    await click("[data-inventory-top-tab='ingame']");
    expect(q("[data-card-guard]")).toBeNull();
    expect(onCardTab()).toBe(false);
  });

  it("switching to In game with a change asks first; Keep editing stays", async () => {
    await openWithChange();
    await click("[data-inventory-top-tab='ingame']");
    const guard = q("[data-card-guard]")!;
    // "You have 1 unsaved change to your card", then the change itself.
    expect(guard.dataset.count).toBe("1");
    expect(guard.querySelectorAll("[data-card-guard-line]")).toHaveLength(1);
    await click("[data-card-guard-keep]");
    expect(q("[data-card-guard]")).toBeNull();
    expect(onCardTab()).toBe(true);
    expect(q("[data-card-save-bar]")).not.toBeNull();
  });

  it("Discard drops the changes and goes", async () => {
    await openWithChange();
    await click("[data-inventory-top-tab='ingame']");
    await click("[data-card-guard-discard]");
    expect(onCardTab()).toBe(false);
    await click("[data-inventory-top-tab='card']");
    expect(q("[data-card-save-bar]")).toBeNull();
  });

  it("Save stores the changes, then goes", async () => {
    vi.mocked(saveCardLoadout).mockResolvedValue({
      ok: true,
      loadout: {} as never,
    });
    await openWithChange();
    await click("[data-inventory-top-tab='ingame']");
    await click("[data-card-guard-save]");
    expect(saveCardLoadout).toHaveBeenCalledWith(
      expect.objectContaining({
        trackers: ["wins", "nukes_launched", "games_played"],
      }),
    );
    expect(onCardTab()).toBe(false);
  });

  it("a Save that fails stays, with the changes", async () => {
    vi.mocked(saveCardLoadout).mockResolvedValue({
      ok: false,
      error: "failed",
    });
    await openWithChange();
    await click("[data-inventory-top-tab='ingame']");
    await click("[data-card-guard-save]");
    expect(onCardTab()).toBe(true);
    expect(q("[data-card-save-toast]")).not.toBeNull();
  });

  it("Back asks first; Discard closes the Inventory", async () => {
    await openWithChange();
    back().click();
    await settle(modal);
    expect(q("[data-card-guard]")).not.toBeNull();
    expect(modal.isOpen()).toBe(true);
    await click("[data-card-guard-discard]");
    expect(modal.isOpen()).toBe(false);
  });

  it("a close the guard didn't see (another modal's link, browser Back) drops the changes", async () => {
    await openWithChange();
    // The router closing it directly, with no guard.
    modal.close();
    await settle(modal);
    // Reopened on In game: closing again doesn't ask about stale changes...
    modal.open({ tab: "skins" });
    await settle(modal);
    back().click();
    await settle(modal);
    expect(q("[data-card-guard]")).toBeNull();
    expect(modal.isOpen()).toBe(false);
    // ...and they don't come back on the card tab.
    modal.open({ tab: "card" });
    await settle(modal);
    expect(q("[data-card-save-bar]")).toBeNull();
    expect(saveCardLoadout).not.toHaveBeenCalled();
  });

  it("Escape asks first; Escape again keeps editing", async () => {
    await openWithChange();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle(modal);
    expect(q("[data-card-guard]")).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle(modal);
    expect(q("[data-card-guard]")).toBeNull();
    expect(modal.isOpen()).toBe(true);
  });
});

describe("Inventory: Player card tab, signed out", () => {
  let modal: InventoryModal;
  beforeEach(() => {
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog());
    vi.mocked(userAuth).mockResolvedValue(false);
    modal = document.createElement("inventory-modal") as InventoryModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
  });
  afterEach(() => {
    modal.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows the same sign-in prompt as In game, and no card", async () => {
    modal.open({ tab: "card" });
    await settle(modal);
    expect(modal.querySelector("[data-inventory-sign-in]")).not.toBeNull();
    expect(modal.querySelector("inventory-card-tab")).toBeNull();
    expect(modal.querySelector("player-card")).toBeNull();
  });
});

describe("Inventory: buying card items in place", () => {
  let modal: InventoryModal;
  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog());
    vi.mocked(userAuth).mockResolvedValue({
      jwt: "token",
      claims: {},
    } as Awaited<ReturnType<typeof userAuth>>);
    vi.mocked(getUserMe).mockResolvedValue(owner());
    modal = document.createElement("inventory-modal") as InventoryModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
  });
  afterEach(() => {
    modal.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });
  const q = <T extends HTMLElement = HTMLElement>(s: string) =>
    modal.querySelector<T>(s);
  async function click(selector: string) {
    q(selector)!.click();
    await settle(modal);
  }
  async function pickStorm() {
    modal.open({ tab: "card" });
    await settle(modal);
    await click("[data-card-slot='background']");
    await click("[data-card-filter='all']");
    await click("[data-card-pick='cardBackground:bg_storm'] [data-tile-main]");
  }

  it("closing with an unowned item: the guard counts it, Save is off, Discard drops it", async () => {
    await pickStorm();
    q<HTMLButtonElement>("[slot='header'] button")!.click();
    await settle(modal);
    expect(q("[data-card-guard]")!.dataset.count).toBe("1");
    expect(q<HTMLButtonElement>("[data-card-guard-save]")!.disabled).toBe(true);
    expect(q("[data-card-guard-buy-first]")).not.toBeNull();
    await click("[data-card-guard-discard]");
    expect(modal.isOpen()).toBe(false);
    modal.open({ tab: "card" });
    await settle(modal);
    expect(q("[data-card-save-bar]")).toBeNull();
    expect(q("[data-card-slot='background']")!.textContent).not.toContain(
      "inventory_card.was",
    );
  });

  it("the fresh profile a purchase broadcasts keeps the changes, with no reload", async () => {
    await pickStorm();
    const tab = q("inventory-card-tab");
    expect(q("[data-card-buy='cardBackground:bg_storm']")).not.toBeNull();
    const fresh = owner([...OWNER, "cardBackground:bg_storm"]);
    vi.mocked(getUserMe).mockResolvedValue(fresh);
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: fresh }),
    );
    await settle(modal);
    // The same tab, never the loading skeleton in between.
    expect(q("inventory-card-tab")).toBe(tab);
    expect(q("[data-card-buy]")).toBeNull();
    expect(q<HTMLButtonElement>("[data-card-save]")!.disabled).toBe(false);
    expect(q("[data-card-change-count]")).not.toBeNull();
  });

  /** Opens <purchase-button>'s confirm box for a currency, the way a tap
   * on its button does (the tap check runs first). */
  async function openConfirm(within: string, method: "hard" | "soft") {
    const button = q(`${within} purchase-button`) as unknown as {
      requestCurrencyPurchase(m: "hard" | "soft"): void;
    };
    button.requestCurrencyPurchase(method);
    await settle(modal);
    expect(q(`${within} confirm-dialog`)).not.toBeNull();
  }

  it("Escape with the Save bar's buy confirm open closes the confirm, not the Inventory", async () => {
    await pickStorm();
    await openConfirm("[data-card-buy='cardBackground:bg_storm']", "soft");
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.removeEventListener("keydown", behind);
    await settle(modal);
    expect(q("confirm-dialog")).toBeNull();
    expect(q("[data-card-guard]")).toBeNull();
    expect(behind).not.toHaveBeenCalled();
    expect(modal.isOpen()).toBe(true);
    // The change is still there.
    expect(q("[data-card-buy='cardBackground:bg_storm']")).not.toBeNull();
  });

  it("Escape with the no-card screen's buy confirm open closes only the confirm", async () => {
    const noCard = owner(["cardBackground:bg_pacific"]);
    vi.mocked(getUserMe).mockResolvedValue(noCard);
    modal.open({ tab: "card" });
    await settle(modal);
    await openConfirm("[data-card-get-card]", "hard");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle(modal);
    expect(q("confirm-dialog")).toBeNull();
    expect(modal.isOpen()).toBe(true);
    expect(q("[data-card-get-card]")).not.toBeNull();
  });
});
