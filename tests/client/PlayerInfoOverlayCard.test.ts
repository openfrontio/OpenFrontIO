/**
 * The hover player summary shows a card owner's background art, still, behind
 * its info row under a dark gradient — only from 640px up, where the overlay
 * is a fixed-width panel. Withheld wherever the viewer gets no card for that
 * player (anonymised, bots, nations, no card) and while the viewer anonymises
 * names locally.
 */

vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  LitElement: class extends EventTarget {
    requestUpdate() {}
  },
  nothing: "",
}));
vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: unknown) => clazz,
  state: () => () => {},
  property: () => () => {},
  query: () => () => {},
}));
// An absent attribute flattens to nothing at all.
vi.mock("lit/directives/if-defined.js", () => ({
  ifDefined: (v: unknown) => v ?? "",
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  renderDuration: vi.fn(() => ""),
  getTranslatedPlayerTeamLabel: vi.fn(() => ""),
  getSvgAspectRatio: vi.fn(() => 1),
  formatKeyForDisplay: vi.fn(() => "F"),
}));
vi.mock("@openfront/engine-lib/Format", () => ({
  renderNumber: vi.fn(() => "0"),
  renderTroops: vi.fn(() => "0"),
}));
vi.mock("../../src/client/hud/PlayerIcons", () => ({
  EMOJI_ICON_KIND: "emoji",
  IMAGE_ICON_KIND: "image",
  getFirstPlacePlayer: vi.fn(() => null),
  getPlayerIcons: vi.fn(() => []),
}));
const catalogue = vi.hoisted(() => ({
  cached: null as unknown,
  fetched: undefined as unknown,
  fetches: 0,
}));
vi.mock("../../src/client/Cosmetics", () => ({
  getCachedCosmetics: () => catalogue.cached,
  fetchCosmetics: async () => {
    catalogue.fetches++;
    return catalogue.fetched === undefined
      ? catalogue.cached
      : catalogue.fetched;
  },
}));

import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { PlayerCard } from "@openfront/shared/PlayerCardSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadedCardBackgroundUrl,
  resetCardBackdropLoadsForTests,
} from "../../src/client/components/card/StillCardBackdrop";
import { PlayerInfoOverlay } from "../../src/client/hud/layers/PlayerInfoOverlay";
import { UserSettings } from "../../src/client/UserSettings";
import { installFakeImage } from "../util/FakeImage";

function flatten(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (Array.isArray(node)) return node.map(flatten).join("");
  if (typeof node === "object" && "strings" in (node as object)) {
    const { strings, values } = node as {
      strings: readonly string[];
      values: unknown[];
    };
    return strings.map((s, i) => s + flatten(values[i])).join("");
  }
  if (typeof node === "object") return "";
  return String(node);
}

const COSMETICS = {
  patterns: {},
  flags: {},
  cardBackgrounds: {
    bg_pacific: {
      name: "bg_pacific",
      url: "/cosmetics/bg_pacific.webp",
      rarity: "epic",
      product: null,
    },
  },
};

const CARD: PlayerCard = { trackers: [], background: "bg_pacific" };

function hoveredPlayer(type: PlayerType, clientID: string | null = "bob") {
  return {
    isPlayer: () => true,
    profile: () => Promise.resolve(null),
    getTraitorRemainingTicks: () => 0,
    outgoingAttacks: () => [],
    troops: () => 100,
    gold: () => 0n,
    type: () => type,
    team: () => null,
    displayName: () => "Bob",
    cosmetics: {},
    id: () => "bob",
    smallID: () => 2,
    clientID: () => clientID,
  };
}

function makeOverlay(
  hovered: ReturnType<typeof hoveredPlayer>,
  cards: Record<string, PlayerCard | undefined>,
): PlayerInfoOverlay {
  const overlay = new PlayerInfoOverlay();
  overlay.eventBus = { on: vi.fn() } as never;
  overlay.transform = {
    screenToWorldCoordinates: () => ({ x: 5, y: 5 }),
  } as never;
  overlay.init();
  overlay.game = {
    isValidCoord: () => true,
    ref: () => 42,
    owner: () => hovered,
    myPlayer: () => null,
    myClientID: () => "me",
    inSpawnPhase: () => false,
    config: () => ({
      isUnitDisabled: () => true,
      maxTroops: () => 1000,
      isReplay: () => false,
      gameConfig: () => ({}),
    }),
    teamClanTag: () => undefined,
    playerCardOf: (id: string) => ({ card: cards[id], flag: undefined }),
  } as never;
  overlay.maybeShow(10, 10);
  return overlay;
}

function show(
  hovered: ReturnType<typeof hoveredPlayer>,
  cards: Record<string, PlayerCard | undefined>,
): string {
  return flatten(makeOverlay(hovered, cards).render());
}

const settle = () => new Promise((r) => setTimeout(r, 0));

// The info row: the first element inside the panel.
const BACKDROP_CLASS = "sm:[background-image:var(--card-backdrop)]";

describe("player summary: card background", () => {
  beforeEach(async () => {
    catalogue.cached = COSMETICS;
    catalogue.fetched = undefined;
    catalogue.fetches = 0;
    resetCardBackdropLoadsForTests();
    installFakeImage((src) => src.includes("broken"));
    // Most tests start with the art already loaded.
    loadedCardBackgroundUrl("bg_pacific", COSMETICS as never, () => {});
    await settle();
    vi.spyOn(UserSettings.prototype, "anonymousNames").mockReturnValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("before the art has loaded: no backdrop; after: shown", async () => {
    resetCardBackdropLoadsForTests();
    const overlay = makeOverlay(hoveredPlayer(PlayerType.Human), { bob: CARD });
    expect(flatten(overlay.render())).not.toContain("--card-backdrop");
    await settle();
    expect(flatten(overlay.render())).toContain("--card-backdrop");
  });

  it("art that fails to load: today's row, for good", async () => {
    const broken = {
      ...COSMETICS,
      cardBackgrounds: {
        bg_pacific: {
          ...COSMETICS.cardBackgrounds.bg_pacific,
          url: "/broken.webp",
        },
      },
    };
    catalogue.cached = broken;
    const overlay = makeOverlay(hoveredPlayer(PlayerType.Human), { bob: CARD });
    const before = flatten(overlay.render());
    await settle();
    const after = flatten(overlay.render());
    expect(after).not.toContain("--card-backdrop");
    expect(after).toBe(before);
    expect(after).toBe(show(hoveredPlayer(PlayerType.Human), {}));
  });

  it("a failed catalogue fetch is retried on a later render", async () => {
    catalogue.cached = null;
    catalogue.fetched = null;
    const overlay = makeOverlay(hoveredPlayer(PlayerType.Human), { bob: CARD });
    overlay.render();
    overlay.render();
    expect(catalogue.fetches).toBe(1);
    await settle();
    overlay.render();
    expect(catalogue.fetches).toBe(1);
    // Not straight away: CATALOGUE_RETRY_MS after the failure.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    overlay.render();
    expect(catalogue.fetches).toBe(2);
  });

  it("a card owner's background sits behind the row, centre band, under a gradient", () => {
    const out = show(hoveredPlayer(PlayerType.Human), { bob: CARD });
    expect(out).toContain(BACKDROP_CLASS);
    expect(out).toContain("bg-cover");
    expect(out).toContain("bg-center");
    expect(out).toMatch(
      /--card-backdrop: linear-gradient\([^;]*\), url\("[^"]*bg_pacific\.webp"\)/,
    );
    expect(out).toContain("Bob");
  });

  it("only from 640px: the image is a sm: class, never set unprefixed", () => {
    const out = show(hoveredPlayer(PlayerType.Human), { bob: CARD });
    expect(out).not.toMatch(/(^|[\s"])\[background-image:/);
    expect(out).not.toMatch(/style="[^"]*background-image/);
  });

  it("is never animated: no card-background element, so no effect layers", () => {
    const out = show(hoveredPlayer(PlayerType.Human), { bob: CARD });
    expect(out).not.toContain("<card-background");
    expect(out).not.toContain("animated");
  });

  it("doesn't change the layout: same markup as without, minus the backdrop", () => {
    const strip = (s: string) =>
      s
        .replace(` ${BACKDROP_CLASS} bg-cover bg-center`, "")
        .replace(/style=--card-backdrop: [^\n]*/, "style=");
    const carded = show(hoveredPlayer(PlayerType.Human), { bob: CARD });
    const plain = show(hoveredPlayer(PlayerType.Human), {});
    expect(strip(carded)).toBe(plain);
  });

  it.each([
    ["no card (or withheld: anonymised)", PlayerType.Human, {}],
    [
      "a card without a background",
      PlayerType.Human,
      { bob: { trackers: [] } },
    ],
    ["a bot", PlayerType.Bot, { bob: CARD }],
    ["a nation", PlayerType.Nation, { bob: CARD }],
  ])("withheld for %s", (_label, type, cards) => {
    const out = show(hoveredPlayer(type), cards as never);
    expect(out).not.toContain(BACKDROP_CLASS);
    expect(out).not.toContain("--card-backdrop");
  });

  it("withheld while the catalogue isn't loaded", () => {
    catalogue.cached = null;
    const out = show(hoveredPlayer(PlayerType.Human), { bob: CARD });
    expect(out).not.toContain("--card-backdrop");
  });

  it("withheld while the viewer anonymises other players' names", () => {
    vi.spyOn(UserSettings.prototype, "anonymousNames").mockReturnValue(true);
    const out = show(hoveredPlayer(PlayerType.Human), { bob: CARD });
    expect(out).not.toContain("--card-backdrop");
  });

  it("the viewer's own card still shows with anonymous names on", () => {
    vi.spyOn(UserSettings.prototype, "anonymousNames").mockReturnValue(true);
    const out = show(hoveredPlayer(PlayerType.Human, "me"), { me: CARD });
    expect(out).toContain("--card-backdrop");
  });
});
