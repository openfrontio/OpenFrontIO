import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type LobbyStoreRow,
  lobbyStorePicks,
} from "../../src/client/components/LobbyStoreRow";
import type { PurchaseButton } from "../../src/client/components/PurchaseButton";
import {
  fetchCosmetics,
  purchaseCosmetic,
  resolveCosmetics,
  type ResolvedCosmetic,
} from "../../src/client/Cosmetics";
import { COSMETICS_CHANGED } from "../../src/client/Experiments";

// The join lobby's store row (the lobby_store ui test's treatment): the
// store's Featured picks, bought in place, placed as join_lobby.

const tracker = vi.hoisted(() => ({
  observe: vi.fn(),
  click: vi.fn(),
  releaseDetached: vi.fn(),
  flush: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../../src/client/StoreTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/StoreTracking")>()),
  StoreTracker: class {
    observe = tracker.observe;
    click = tracker.click;
    releaseDetached = tracker.releaseDetached;
    flush = tracker.flush;
    dispose = tracker.dispose;
  },
}));

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(async () => false),
}));

vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: vi.fn(),
  purchaseCosmetic: vi.fn(),
  resolveCosmetics: vi.fn(),
}));

const PLACEMENT = { kind: "join_lobby" };
const hour = () => new Date(Date.now() + 3_600_000).toISOString();
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const flash = { id: "f", name: "Flash", percentOff: 50, endsAt: hour() };
const sale = { id: "s", name: "Autumn", percentOff: 25, endsAt: hour() };

function item(
  type: ResolvedCosmetic["type"],
  name: string,
  extra: Record<string, unknown> = {},
  relationship: ResolvedCosmetic["relationship"] = "purchasable",
): ResolvedCosmetic {
  return {
    type,
    cosmetic: {
      name,
      pattern: "AAAAAA",
      product: null,
      priceHard: 120,
      rarity: "rare",
      affiliateCode: null,
      ...extra,
    } as never,
    colorPalette: null,
    relationship,
    key: `${type}:${name}`,
  };
}
const onSale = (promotion: object) => ({
  priceHard: 60,
  listPriceHard: 120,
  promotion,
});
const names = (picks: ResolvedCosmetic[]) =>
  picks.map((r) => (r.cosmetic as { name: string }).name);

describe("lobbyStorePicks", () => {
  it("takes the flash deal, then new, then on sale, three at most", () => {
    const picks = lobbyStorePicks([
      item("pattern", "plain"),
      item("pattern", "sale1", onSale(sale)),
      item("flag", "fresh1", { newUntil: days(2) }),
      item("pattern", "deal", onSale({ ...flash, kind: "flash" })),
      item("crown", "fresh2", { newUntil: days(5) }),
      item("pattern", "sale2", onSale(sale)),
    ]);
    expect(names(picks)).toEqual(["deal", "fresh2", "fresh1"]);
  });

  it("fills with on sale items when little is new", () => {
    const picks = lobbyStorePicks([
      item("effect", "fresh", { newUntil: days(2) }),
      item("pattern", "sale1", onSale(sale)),
      item("pattern", "plain"),
    ]);
    expect(names(picks)).toEqual(["fresh", "sale1"]);
  });

  it("leaves out what can't be bought in place, or at all", () => {
    const picks = lobbyStorePicks([
      item("cosmeticPack", "bundle", onSale(sale)),
      item("pack", "plutonium", { newUntil: days(2) }),
      item("pattern", "owned", onSale(sale), "owned"),
      item("pattern", "plain"),
    ]);
    expect(picks).toEqual([]);
  });
});

describe("<lobby-store-row>", () => {
  let picks: ResolvedCosmetic[];

  async function mount(): Promise<LobbyStoreRow> {
    const row = document.createElement("lobby-store-row") as LobbyStoreRow;
    document.body.appendChild(row);
    await vi.waitFor(() =>
      expect(row.querySelectorAll("cosmetic-card")).toHaveLength(picks.length),
    );
    await row.updateComplete;
    return row;
  }

  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    picks = [
      item("pattern", "deal", onSale({ ...flash, kind: "flash" })),
      item("flag", "fresh", { newUntil: days(2) }),
    ];
    vi.mocked(fetchCosmetics).mockResolvedValue({} as Cosmetics);
    vi.mocked(resolveCosmetics).mockImplementation(() => picks);
    vi.mocked(purchaseCosmetic).mockReset().mockResolvedValue(undefined);
    for (const fn of Object.values(tracker)) fn.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("renders nothing with nothing to sell", async () => {
    picks = [item("pattern", "plain")];
    const row = document.createElement("lobby-store-row") as LobbyStoreRow;
    document.body.appendChild(row);
    await vi.waitFor(() => expect(resolveCosmetics).toHaveBeenCalled());
    await row.updateComplete;
    expect(row.querySelector("[data-lobby-store]")).toBeNull();
  });

  it("buys in place at the shown price, placed as join_lobby", async () => {
    const row = await mount();
    const button = row.querySelector<PurchaseButton>(
      '[data-cosmetic-key="pattern:deal"] purchase-button',
    )!;
    button.requestCurrencyPurchase("hard");
    await button.updateComplete;
    button
      .querySelector("confirm-dialog")!
      .dispatchEvent(new CustomEvent("confirm"));
    await vi.waitFor(() =>
      expect(purchaseCosmetic).toHaveBeenCalledWith(
        picks[0],
        "hard",
        PLACEMENT,
        60,
      ),
    );
  });

  it("tracks impressions and clicks as join_lobby", async () => {
    const row = await mount();
    expect(tracker.observe).toHaveBeenCalledWith(
      row.querySelector('[data-cosmetic-key="pattern:deal"]'),
      "pattern:deal",
      PLACEMENT,
    );
    expect(tracker.observe).toHaveBeenCalledWith(
      row.querySelector('[data-cosmetic-key="flag:fresh"]'),
      "flag:fresh",
      PLACEMENT,
    );
    row
      .querySelector('[data-cosmetic-key="flag:fresh"] purchase-button')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(tracker.click).toHaveBeenCalledWith("flag:fresh", PLACEMENT);
  });

  it("picks again when the catalog changes, and stops with the lobby", async () => {
    const row = await mount();
    picks = [picks[1]];
    document.dispatchEvent(new CustomEvent(COSMETICS_CHANGED));
    await vi.waitFor(() =>
      expect(row.querySelectorAll("cosmetic-card")).toHaveLength(1),
    );
    row.remove();
    expect(tracker.flush).toHaveBeenCalled();
    expect(tracker.dispose).toHaveBeenCalled();
  });
});
