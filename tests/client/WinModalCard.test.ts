import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (orig) => ({
  ...(await orig<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const catalogue = vi.hoisted(() => ({
  cached: null as unknown,
  fetched: null as unknown,
}));
vi.mock("../../src/client/Cosmetics", async (orig) => ({
  ...(await orig<typeof import("../../src/client/Cosmetics")>()),
  getCachedCosmetics: () => catalogue.cached,
  fetchCosmetics: async () => catalogue.fetched,
}));

// The session as Auth.userAuth sees it. Like the real one (Auth.ts), a
// token expired or within 3 minutes of expiry is refreshed only when asked
// to (shouldRefresh, the default); userAuth(false) answers false for it.
// `real` hands the call to the real userAuth, with fetch stubbed, so a
// refresh's answer goes through Auth.ts's own handling.
const auth = vi.hoisted(() => ({
  session: true,
  expired: false,
  throws: false,
  real: false,
}));
vi.mock("../../src/client/Auth", async (orig) => {
  const real = await orig<typeof import("../../src/client/Auth")>();
  return {
    ...real,
    // The mocked session is never settled "signed out" ahead of time, so
    // those tests go through userAuth() as before.
    knownSignedOut: () => (auth.real ? real.knownSignedOut() : false),
    userAuth: async (shouldRefresh = true) => {
      if (auth.real) return real.userAuth(shouldRefresh);
      if (auth.throws) throw new Error("auth broke");
      if (!auth.session) return false;
      if (auth.expired) {
        if (!shouldRefresh) return false;
        auth.expired = false; // refreshed from the refresh cookie
      }
      return { jwt: "j", claims: {} };
    },
  };
});

import {
  clearLocalSession,
  knownSignedOut,
  userAuth,
} from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";
import { defaultPlayerCardView } from "../../src/client/components/card/PlayerCardModel";
import {
  clearSavedLooks,
  saveLook,
} from "../../src/client/components/card/SavedLooks";
import { WinModal } from "../../src/client/hud/layers/WinModal";
import { UserSettings } from "../../src/client/UserSettings";

if (!customElements.get("win-modal")) {
  customElements.define("win-modal", WinModal);
}

// WinModal with no game attached: enough to render the modal's frame and
// check where the card section sits and that nothing else moved.
async function renderModal(state: Record<string, unknown>) {
  const modal = document.createElement("win-modal") as unknown as WinModal &
    Record<string, unknown>;
  Object.assign(modal, {
    isVisible: true,
    _title: "You died",
    // The store-skins turn, so no random Steam or Discord promo.
    rand: 0.9,
    ...state,
  });
  document.body.appendChild(modal as unknown as Node);
  await modal.updateComplete;
  const section = modal.querySelector("end-card-section") as unknown as {
    updateComplete: Promise<unknown>;
  } | null;
  await section?.updateComplete;
  return modal as unknown as HTMLElement;
}

describe("WinModal card section", () => {
  // Past the first three games, so the tutorial doesn't take the promo box.
  beforeEach(() => {
    localStorage.setItem("gamesPlayed", "10");
  });
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem("gamesPlayed");
  });

  it("eliminated by a human shows label and killer card above XP panel", async () => {
    const modal = await renderModal({
      endCardMode: "eliminatedBy",
      endCardView: defaultPlayerCardView("Volt", "UN"),
    });
    const order = [
      ...modal.querySelectorAll("h2, [data-end-card], game-xp-panel"),
    ].map((el) =>
      el.tagName === "H2"
        ? "h2"
        : el.hasAttribute("data-end-card")
          ? "card"
          : "xp",
    );
    expect(order).toEqual(["h2", "card", "xp"]);
  });

  it("fetches the catalogue when it isn't cached, then shows the items", async () => {
    catalogue.cached = null;
    catalogue.fetched = {
      patterns: {},
      flags: {},
      cardBackgrounds: {
        bg_pacific: {
          product: null,
          rarity: "epic",
          name: "bg_pacific",
          url: "/bg.webp",
        },
      },
    };
    const modal = (await renderModal({})) as unknown as {
      game: unknown;
      setEndCard(choose: () => unknown): void;
      endCardView: { background: { name: string } | null } | null;
      updateComplete: Promise<unknown>;
    };
    modal.game = {
      myPlayer: () => null,
      gameID: () => "g1",
      config: () => ({ gameConfig: () => ({}) }),
      resumedFromSave: () => false,
      playerByClientID: () => ({
        name: () => "Volt",
        clanTag: () => null,
        territoryColor: () => ({ toHex: () => "#123456" }),
      }),
      playerCardOf: () => ({
        card: { background: "bg_pacific", trackers: [] },
        flag: undefined,
      }),
    };
    modal.setEndCard(() => ({ kind: "winner", clientID: "KILLER01" }));
    expect(modal.endCardView?.background).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;
    expect(modal.endCardView?.background?.name).toBe("bg_pacific");
    catalogue.fetched = null;
  });

  it("a failure choosing the card leaves today's screen", async () => {
    const modal = (await renderModal({
      endCardMode: "eliminatedBy",
      endCardView: defaultPlayerCardView("Volt", "UN"),
    })) as unknown as {
      game: unknown;
      setEndCard(choose: () => unknown): void;
      endCardMode: string;
    };
    // A game without the card lookups (an older view, a test double).
    modal.game = {
      myPlayer: () => null,
      gameID: () => "g1",
      config: () => ({ gameConfig: () => ({}) }),
      resumedFromSave: () => false,
    };
    expect(() =>
      modal.setEndCard(() => {
        throw new TypeError("playerCardOf is not a function");
      }),
    ).not.toThrow();
    expect(modal.endCardMode).toBe("none");
  });

  it("no card shows today's screen", async () => {
    const modal = await renderModal({ endCardMode: "none" });
    expect(modal.querySelector("[data-end-card]")).toBeNull();
  });

  it("promo slot, buttons and ffa panel unchanged", async () => {
    const actions = (modal: HTMLElement) =>
      [...modal.querySelectorAll("[data-win-action]")].map((a) =>
        a.getAttribute("data-win-action"),
      );
    const without = await renderModal({ endCardMode: "none", rand: 0.9 });
    const before = {
      actions: actions(without),
      promo: without.querySelector("[data-win-cosmetic-promo]") !== null,
    };
    expect(before.actions.length).toBeGreaterThan(0);
    document.body.innerHTML = "";
    const withCard = await renderModal({
      endCardMode: "winner",
      endCardView: defaultPlayerCardView("Volt", "UN"),
      rand: 0.9,
    });
    expect({
      actions: actions(withCard),
      promo: withCard.querySelector("[data-win-cosmetic-promo]") !== null,
    }).toEqual(before);
  });
});

// One "Get the look" block in the promo slot: the killer's look first, then
// looks saved from the player panel this game, newest first, filtered against
// what the viewer owns now. It takes the slot from Steam, Discord, tutorial
// and skins; without a look the promo is as today.
describe("WinModal Get the look block", () => {
  const bg = (name: string) => ({
    type: "cardBackground",
    item: { name, rarity: "epic", product: null },
    state: "buy",
    priceHard: 400,
  });
  const CARD = {
    type: "playerCard",
    item: { name: "standard", rarity: "rare", product: null },
    state: "buy",
    priceHard: 300,
  };
  const look = (clientID: string, name: string, items: unknown[]) => ({
    clientID,
    name,
    items: items as never,
  });
  const KILLER_ITEM = {
    type: "taunt",
    item: { name: "salute", rarity: "epic", product: null },
    state: "buy",
    priceSoft: 800,
  };
  const game = {
    gameID: () => "g1",
    config: () => ({ gameConfig: () => ({}) }),
    myPlayer: () => null,
    resumedFromSave: () => false,
  };
  // What the viewer owns, read when the screen shows.
  const base = { game, viewerFlares: [] as string[] };
  const killed = {
    endCardMode: "eliminatedBy",
    endCardView: defaultPlayerCardView("Volt", "UN"),
    lastEndCard: { kind: "eliminatedBy", clientID: "killer" },
  };
  type Block = {
    looks: {
      clientID: string;
      name: string;
      items: { item: { name: string } }[];
    }[];
  };
  const block = (modal: HTMLElement) =>
    modal.querySelector("loadout-row") as unknown as Block | null;
  // The block's players, in chip order.
  const names = (modal: HTMLElement) =>
    (block(modal)?.looks ?? []).map((l) => l.name);
  const items = (modal: HTMLElement, name: string) =>
    block(modal)!
      .looks.find((l) => l.name === name)!
      .items.map((i) => i.item.name);
  // Today's Discord promo (rand 0.4), as a stand-in for any of them.
  const promo = (modal: HTMLElement) =>
    modal.textContent!.includes("win_modal.join_discord");

  beforeEach(() => {
    localStorage.setItem("gamesPlayed", "10");
    clearSavedLooks();
    vi.spyOn(UserSettings.prototype, "anonymousNames").mockReturnValue(false);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem("gamesPlayed");
    clearSavedLooks();
    vi.restoreAllMocks();
  });

  it("is one block: the killer first, then saved looks newest first", async () => {
    saveLook("g1", look("a", "Ada", [bg("bg_a")]));
    saveLook("g1", look("b", "Bo", [bg("bg_b")]));
    const modal = await renderModal({
      ...base,
      ...killed,
      loadout: [KILLER_ITEM],
    });
    expect(modal.querySelectorAll("loadout-row")).toHaveLength(1);
    expect(names(modal)).toEqual(["Volt", "Bo", "Ada"]);
  });

  it("takes the promo slot from every other promo", async () => {
    saveLook("g1", look("a", "Ada", [bg("bg_a")]));
    // rand 0.1 would be Steam, 0.4 Discord; the first games the tutorial.
    for (const state of [{ rand: 0.1 }, { rand: 0.4 }, { rand: 0.9 }]) {
      const modal = await renderModal({
        ...base,
        endCardMode: "none",
        ...state,
      });
      expect(names(modal)).toEqual(["Ada"]);
      expect(promo(modal)).toBe(false);
      document.body.innerHTML = "";
    }
    localStorage.setItem("gamesPlayed", "1");
    const first = await renderModal({ ...base, endCardMode: "none" });
    expect(names(first)).toEqual(["Ada"]);
  });

  it("without a look the promo is as today", async () => {
    const modal = await renderModal({
      ...base,
      endCardMode: "none",
      rand: 0.4,
    });
    expect(block(modal)).toBeNull();
    expect(promo(modal)).toBe(true);
  });

  it("the killer's look alone takes the slot", async () => {
    const modal = await renderModal({
      ...base,
      ...killed,
      loadout: [KILLER_ITEM],
      rand: 0.1,
    });
    expect(names(modal)).toEqual(["Volt"]);
  });

  it("shows on the win screen too", async () => {
    saveLook("g1", look("a", "Ada", [bg("bg_a")]));
    const modal = await renderModal({
      ...base,
      isWin: true,
      endCardMode: "winner",
      endCardView: defaultPlayerCardView("Me", "UN"),
      lastEndCard: { kind: "winner", clientID: "me" },
    });
    expect(names(modal)).toEqual(["Ada"]);
  });

  it("shows under a clan-win card", async () => {
    saveLook("g1", look("a", "Ada", [bg("bg_a")]));
    const modal = await renderModal({
      ...base,
      endCardMode: "clan",
      endCardClan: { clanTag: "UN", members: [], territoryPct: 40 },
      lastEndCard: { kind: "clan", clanTag: "UN", team: "Red" },
    });
    expect(names(modal)).toEqual(["Ada"]);
  });

  it("the killer's saved look is one chip, not two", async () => {
    saveLook("g1", look("killer", "Volt", [bg("bg_k")]));
    saveLook("g1", look("a", "Ada", [bg("bg_a")]));
    const modal = await renderModal({
      ...base,
      ...killed,
      loadout: [KILLER_ITEM],
    });
    expect(names(modal)).toEqual(["Volt", "Ada"]);
  });

  it("the killer's saved look still shows when they have nothing else", async () => {
    saveLook("g1", look("killer", "Volt", [bg("bg_k")]));
    const modal = await renderModal({ ...base, ...killed, loadout: [] });
    expect(names(modal)).toEqual(["Volt"]);
  });

  it("the player card is offered under the first name only", async () => {
    saveLook("g1", look("a", "Ada", [CARD, bg("bg_a")]));
    const modal = await renderModal({
      ...base,
      ...killed,
      loadout: [CARD, KILLER_ITEM],
    });
    expect(items(modal, "Volt")).toEqual(["standard", "salute"]);
    expect(items(modal, "Ada")).toEqual(["bg_a"]);
  });

  it("the same item is offered once, under the earlier name", async () => {
    saveLook("g1", look("a", "Ada", [bg("bg_x"), bg("bg_a")]));
    saveLook("g1", look("b", "Bo", [bg("bg_x"), bg("bg_b")]));
    const modal = await renderModal({ ...base, endCardMode: "none" });
    expect(items(modal, "Bo")).toEqual(["bg_x", "bg_b"]);
    expect(items(modal, "Ada")).toEqual(["bg_a"]);
  });

  it("drops items bought after saving, and players left with nothing", async () => {
    saveLook("g1", look("a", "Ada", [bg("bg_a"), bg("bg_a2")]));
    saveLook("g1", look("b", "Bo", [bg("bg_b")]));
    const modal = await renderModal({
      ...base,
      viewerFlares: ["cardBackground:bg_a", "cardBackground:bg_b"],
      endCardMode: "none",
    });
    expect(names(modal)).toEqual(["Ada"]);
    expect(items(modal, "Ada")).toEqual(["bg_a2"]);
  });

  it("everything owned: no block, the promo as today", async () => {
    saveLook("g1", look("a", "Ada", [bg("bg_a")]));
    const modal = await renderModal({
      ...base,
      viewerFlares: ["cardBackground:bg_a"],
      endCardMode: "none",
      rand: 0.4,
    });
    expect(block(modal)).toBeNull();
    expect(promo(modal)).toBe(true);
  });

  it("not by real name while the viewer anonymises names", async () => {
    vi.spyOn(UserSettings.prototype, "anonymousNames").mockReturnValue(true);
    saveLook("g1", look("a", "Ada", [bg("bg_a")]));
    const modal = await renderModal({ ...base, endCardMode: "none" });
    expect(block(modal)).toBeNull();
  });

  it("no flicker: the slot stays empty until the killer's look has loaded", async () => {
    saveLook("g1", look("a", "Ada", [bg("bg_a")]));
    const modal = (await renderModal({
      ...base,
      ...killed,
      loadout: [],
      loadoutPending: true,
      rand: 0.4,
    })) as HTMLElement & Record<string, unknown>;
    // Neither the block nor the Discord promo it would replace.
    expect(block(modal)).toBeNull();
    expect(promo(modal)).toBe(false);
    modal.loadout = [KILLER_ITEM];
    modal.loadoutPending = false;
    await (modal as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;
    expect(names(modal)).toEqual(["Volt", "Ada"]);
  });

  it("no flicker: the slot stays empty until the viewer's items are read", async () => {
    saveLook("g1", look("a", "Ada", [bg("bg_a")]));
    const modal = await renderModal({ game, endCardMode: "none", rand: 0.4 });
    expect(block(modal)).toBeNull();
    expect(promo(modal)).toBe(false);
  });

  it("no killer card and no saved look: the promo shows without waiting for /users/@me", async () => {
    // viewerFlares not read yet (null), but there is nothing to check.
    const modal = await renderModal({ game, endCardMode: "none", rand: 0.4 });
    expect(block(modal)).toBeNull();
    expect(promo(modal)).toBe(true);
  });

  it("a killer card still loading: waits, even with no saved look", async () => {
    const modal = await renderModal({
      game,
      ...killed,
      loadout: [],
      loadoutPending: true,
      rand: 0.4,
    });
    expect(promo(modal)).toBe(false);
  });

  it("re-renders when a look is saved or removed", async () => {
    const modal = await renderModal({ ...base, endCardMode: "none" });
    expect(block(modal)).toBeNull();
    saveLook("g1", look("a", "Ada", [bg("bg_a")]));
    await (modal as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;
    expect(names(modal)).toEqual(["Ada"]);
  });

  it("another game's looks never show", async () => {
    saveLook("g0", look("a", "Ada", [bg("bg_a")]));
    const modal = await renderModal({ ...base, endCardMode: "none" });
    expect(block(modal)).toBeNull();
  });
});

// Buying from the block: balances and ownership refresh in place from the
// /users/@me broadcast; an item bought here reads Owned ✓ where it was bought.
describe("WinModal Get the look buying", () => {
  const bg = (name: string) => ({
    type: "cardBackground",
    item: { name, rarity: "epic", product: null },
    state: "buy",
    priceHard: 400,
  });
  const SALUTE = {
    type: "taunt",
    item: { name: "salute", rarity: "epic", product: null },
    state: "buy",
    priceSoft: 800,
  };
  const game = {
    gameID: () => "g1",
    config: () => ({ gameConfig: () => ({}) }),
    myPlayer: () => null,
    resumedFromSave: () => false,
  };
  type Block = HTMLElement & {
    looks: { name: string; items: { item: { name: string } }[] }[];
    owned: ReadonlySet<string>;
    signedIn: boolean;
  };
  const block = (modal: HTMLElement) =>
    modal.querySelector("loadout-row") as Block;
  const broadcast = (flares: string[], hard: number, soft: number) =>
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: {
          player: { publicId: "p1", flares, currency: { hard, soft } },
        },
      }),
    );
  const settle = (modal: HTMLElement) =>
    (modal as unknown as { updateComplete: Promise<unknown> }).updateComplete;

  beforeEach(() => {
    localStorage.setItem("gamesPlayed", "10");
    clearSavedLooks();
    vi.spyOn(UserSettings.prototype, "anonymousNames").mockReturnValue(false);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem("gamesPlayed");
    clearSavedLooks();
    vi.restoreAllMocks();
  });

  // A guest's viewer read ends in userAuth(), so it waits until a look
  // could show: most end screens have none.
  it("reads the viewer only once a look could show", async () => {
    const read = vi
      .spyOn(
        WinModal.prototype as unknown as {
          loadViewerFlares(): Promise<void>;
        },
        "loadViewerFlares",
      )
      .mockResolvedValue(undefined);
    const modal = await renderModal({ game, endCardMode: "none" });
    expect(read).not.toHaveBeenCalled();
    saveLook("g1", {
      clientID: "a",
      name: "Ada",
      items: [bg("bg_a")] as never,
    });
    await settle(modal);
    expect(read).toHaveBeenCalledOnce();
    // Once per screen, however often it renders.
    saveLook("g1", {
      clientID: "b",
      name: "Bo",
      items: [bg("bg_b")] as never,
    });
    await settle(modal);
    expect(read).toHaveBeenCalledOnce();
  });

  it("tells the block the viewer is signed in", async () => {
    saveLook("g1", {
      clientID: "a",
      name: "Ada",
      items: [bg("bg_a")] as never,
    });
    const modal = await renderModal({
      game,
      endCardMode: "none",
      viewerFlares: [],
      signedIn: true,
    });
    expect(block(modal).signedIn).toBe(true);
  });

  it("signed out: the block says so", async () => {
    saveLook("g1", {
      clientID: "a",
      name: "Ada",
      items: [bg("bg_a")] as never,
    });
    const modal = await renderModal({
      game,
      endCardMode: "none",
      viewerFlares: [],
      signedIn: false,
    });
    expect(block(modal).signedIn).toBe(false);
  });

  it("bought here: Owned ✓ in its row; the other names never offer it", async () => {
    saveLook("g1", {
      clientID: "a",
      name: "Ada",
      items: [SALUTE, bg("bg_a")] as never,
    });
    const modal = await renderModal({
      game,
      endCardMode: "eliminatedBy",
      endCardView: defaultPlayerCardView("Volt", "UN"),
      lastEndCard: { kind: "eliminatedBy", clientID: "killer" },
      loadout: [SALUTE],
      viewerFlares: [],
      signedIn: true,
    });
    // A buy's order (purchaseCosmeticInPlace's onOwned, then its
    // broadcast): look-owned first, then the fresh profile.
    block(modal).dispatchEvent(
      new CustomEvent("look-owned", {
        detail: { key: "taunt:salute" },
        bubbles: true,
      }),
    );
    broadcast(["taunt:salute"], 0, 4200);
    await settle(modal);
    const looks = block(modal).looks;
    expect(looks.map((l) => l.name)).toEqual(["Volt", "Ada"]);
    expect(looks[0].items.map((i) => i.item.name)).toEqual(["salute"]);
    expect(looks[1].items.map((i) => i.item.name)).toEqual(["bg_a"]);
    expect(block(modal).owned.has("taunt:salute")).toBe(true);
  });

  it("one look, one item, bought: the block stays (no rebuild, no new impressions)", async () => {
    saveLook("g1", {
      clientID: "a",
      name: "Ada",
      items: [bg("bg_a")] as never,
    });
    const modal = await renderModal({
      game,
      endCardMode: "none",
      viewerFlares: [],
      signedIn: true,
    });
    const before = block(modal);
    // A buy's order: look-owned, then the fresh profile.
    before.dispatchEvent(
      new CustomEvent("look-owned", {
        detail: { key: "cardBackground:bg_a" },
        bubbles: true,
      }),
    );
    await settle(modal);
    expect(block(modal)).toBe(before);
    broadcast(["cardBackground:bg_a"], 0, 0);
    await settle(modal);
    expect(block(modal)).toBe(before);
    expect(block(modal).owned.has("cardBackground:bg_a")).toBe(true);
  });

  it("bought here reads Owned ✓ even if the profile refresh fails", async () => {
    saveLook("g1", {
      clientID: "a",
      name: "Ada",
      items: [bg("bg_a"), bg("bg_a2")] as never,
    });
    const modal = await renderModal({
      game,
      endCardMode: "none",
      viewerFlares: [],
      signedIn: true,
    });
    block(modal).dispatchEvent(
      new CustomEvent("look-owned", {
        detail: { key: "cardBackground:bg_a" },
        bubbles: true,
      }),
    );
    // No userMeResponse broadcast follows.
    await settle(modal);
    expect(block(modal).owned.has("cardBackground:bg_a")).toBe(true);
    expect(block(modal).looks[0].items.map((i) => i.item.name)).toEqual([
      "bg_a",
      "bg_a2",
    ]);
  });

  it("owned elsewhere (not bought here): it drops out", async () => {
    saveLook("g1", {
      clientID: "a",
      name: "Ada",
      items: [bg("bg_a"), bg("bg_a2")] as never,
    });
    const modal = await renderModal({
      game,
      endCardMode: "none",
      viewerFlares: [],
      signedIn: true,
    });
    broadcast(["cardBackground:bg_a"], 500, 0);
    await settle(modal);
    expect(block(modal).looks[0].items.map((i) => i.item.name)).toEqual([
      "bg_a2",
    ]);
  });
});

// getUserMe answers false for a failed read (a 5xx, a network error, a bad
// body) as well as for no session, and keeps that false cached. Only the
// session decides "signed out"; a failed read leaves a signed-in player
// signed in (no flares known), so they get real Buy buttons whose tap check
// re-reads, never a "Sign in to buy" that sends them out of their game.
describe("WinModal: signed in is the session, not the profile read", () => {
  type Modal = HTMLElement & {
    applyUserMe(me: unknown): Promise<void>;
    signedIn: boolean;
    viewerFlares: readonly string[] | null;
  };
  afterEach(() => {
    auth.session = true;
    auth.expired = false;
    auth.throws = false;
    auth.real = false;
    clearLocalSession();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  // The real userAuth, no token in memory (none yet, or expired and
  // dropped), and /auth/refresh answering `status`.
  const refreshAnswers = (status: number) => {
    auth.real = true;
    // The local API base, as AuthRefreshFailure.test.ts sets it.
    vi.spyOn(ClientEnv, "jwtAudience").mockReturnValue("localhost");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status,
        ok: status >= 200 && status < 300,
        json: async () => ({}),
      })),
    );
  };

  it("the refresh gets a 503: couldn't check, so still signed in (real Buy buttons)", async () => {
    // A transient refresh failure keeps the refresh cookie: the session may
    // be fine. "Sign in to buy" would send the player out of their game to
    // sign in to an account they're signed in to.
    refreshAnswers(503);
    const modal = (await renderModal({ endCardMode: "none" })) as Modal;
    await modal.applyUserMe(false);
    expect(modal.signedIn).toBe(true);
    expect(modal.viewerFlares).toEqual([]);
  });

  it("the refresh gets a 401: the session is dead, signed out", async () => {
    refreshAnswers(401);
    const modal = (await renderModal({ endCardMode: "none" })) as Modal;
    await modal.applyUserMe(false);
    expect(modal.signedIn).toBe(false);
  });

  it("a guest already known signed out: no refresh, no logout", async () => {
    // Boot's refresh got its 401 (and logout): "signed out" is settled.
    refreshAnswers(401);
    await userAuth();
    await vi.waitFor(() => expect(knownSignedOut()).toBe(true));
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockClear();
    const modal = (await renderModal({ endCardMode: "none" })) as Modal;
    await modal.applyUserMe(false);
    expect(modal.signedIn).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed profile read with a session: still signed in, no flares", async () => {
    auth.session = true;
    const modal = (await renderModal({ endCardMode: "none" })) as Modal;
    await modal.applyUserMe(false);
    expect(modal.signedIn).toBe(true);
    expect(modal.viewerFlares).toEqual([]);
  });

  it("a cached failed read and a token near expiry after a long game: still signed in", async () => {
    // /users/@me failed at boot (false cached, so no request now), and the
    // 15-minute token has expired over a 20-minute game; the refresh cookie
    // is still good.
    auth.session = true;
    auth.expired = true;
    const modal = (await renderModal({ endCardMode: "none" })) as Modal;
    await modal.applyUserMe(false);
    expect(modal.signedIn).toBe(true);
  });

  it("reading the viewer never rejects, even if its fallback throws", async () => {
    // getUserMe fails (it catches the throw and answers false), then the
    // session check in the fallback throws too: nothing may escape the
    // fire-and-forget call in show().
    auth.throws = true;
    const modal = (await renderModal({ endCardMode: "none" })) as Modal & {
      loadViewerFlares(): Promise<void>;
    };
    await expect(modal.loadViewerFlares()).resolves.toBeUndefined();
  });

  it("no session: signed out", async () => {
    auth.session = false;
    const modal = (await renderModal({ endCardMode: "none" })) as Modal;
    await modal.applyUserMe(false);
    expect(modal.signedIn).toBe(false);
  });

  it("a profile: signed in, with its flares", async () => {
    const modal = (await renderModal({ endCardMode: "none" })) as Modal;
    await modal.applyUserMe({ player: { flares: ["taunt:salute"] } });
    expect(modal.signedIn).toBe(true);
    expect(modal.viewerFlares).toEqual(["taunt:salute"]);
  });

  it("an older answer landing late doesn't overwrite a newer one", async () => {
    auth.session = false;
    const modal = (await renderModal({ endCardMode: "none" })) as Modal;
    // The failed read waits on its session check...
    const first = modal.applyUserMe(false);
    // ...while a fresh profile arrives and decides.
    await modal.applyUserMe({ player: { flares: [] } });
    await first;
    expect(modal.signedIn).toBe(true);
  });
});
