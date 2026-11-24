vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  LitElement: class extends EventTarget {
    requestUpdate() {}
  },
}));
vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: unknown) => clazz,
  state: () => () => {},
  property: () => () => {},
  query: () => () => {},
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  renderDuration: vi.fn(),
  renderNumber: vi.fn(),
  renderTroops: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock("../../src/client/components/ui/ActionButton", () => ({
  actionButton: vi.fn((props: unknown) => props),
}));
vi.mock("../../src/client/components/LevelBadge", () => ({}));
vi.mock("../../src/client/components/card/PlayerCard", () => ({}));
vi.mock("../../src/client/components/EquippedCosmeticsRow", () => ({}));
vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getUserMe: vi.fn(async () => false),
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(),
  showInGameAlert: vi.fn(),
}));
const catalogue = vi.hoisted(() => ({
  cached: null as unknown,
  fetched: undefined as unknown,
  fetches: 0,
}));
vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCachedCosmetics: () => catalogue.cached,
  fetchCosmetics: async () => {
    catalogue.fetches++;
    return catalogue.fetched === undefined
      ? catalogue.cached
      : catalogue.fetched;
  },
}));

import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { packLevelBadge } from "@openfront/shared/LevelBadgeWire";
import type { PlayerCard } from "@openfront/shared/PlayerCardSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerPanel } from "../../src/client/hud/layers/PlayerPanel";
import { rememberLobbyRoster } from "../../src/client/LobbyRosterLevels";
import { UserSettings } from "../../src/client/UserSettings";
import { PlayerView } from "../../src/client/view";

// The player panel shows a card owner's compact card in place of the identity
// row: still, one line. Everyone else keeps today's identity row exactly.

function flatten(value: unknown): string {
  if (Array.isArray(value)) return value.map(flatten).join("");
  if (value && typeof value === "object" && "strings" in value) {
    const t = value as { strings: readonly string[]; values: unknown[] };
    return t.strings
      .map((s, i) => s + (i < t.values.length ? flatten(t.values[i]) : ""))
      .join("");
  }
  if (value && typeof value === "object") return `{${JSON.stringify(value)}}`;
  if (typeof value === "function" || value === null || value === undefined) {
    return "";
  }
  return String(value);
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
      animation: { layers: [] },
    },
  },
};
const CARD: PlayerCard = {
  trackers: [{ stat: "wins", value: 1204 }],
  background: "bg_pacific",
  title: "warmonger",
  taunt: "salute",
};

function player(
  clientID: string | null,
  type: PlayerType = PlayerType.Human,
): PlayerView {
  return {
    id: () => clientID ?? "bot",
    name: () => `name-${clientID}`,
    displayName: () => `name-${clientID}`,
    clanTag: () => "UN",
    type: () => type,
    clientID: () => clientID,
    cosmetics: { flag: "/flags/gb.svg" },
  } as unknown as PlayerView;
}

describe("player panel: the compact card", () => {
  let panel: PlayerPanel;
  let cards: Record<string, PlayerCard | undefined>;

  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    catalogue.cached = COSMETICS;
    catalogue.fetched = undefined;
    catalogue.fetches = 0;
    rememberLobbyRoster("game-1", [
      {
        clientID: "vet",
        username: "vet",
        clanTag: null,
        levelBadge: packLevelBadge({ level: 42, prestige: 3, legend: false }),
      },
    ]);
    cards = { vet: CARD, me: CARD };
    panel = new PlayerPanel();
    (panel as any).g = {
      gameID: () => "game-1",
      myClientID: () => "me",
      playerCardOf: (id: string) => ({
        card: cards[id],
        flag: "/flags/fr.svg",
      }),
    };
    (panel as any).renderTraitorBadge = () => "TRAITOR-BADGE";
    (panel as any).renderRelationPillIfNation = () => "RELATION-PILL";
  });
  afterEach(() => vi.restoreAllMocks());

  const row = (other: PlayerView) =>
    flatten((panel as any).renderIdentityRow(other, player("me")));
  // Today's row for this player: the same panel with no card for anyone.
  const todays = (other: PlayerView) => {
    const saved = cards;
    cards = {};
    const out = row(other);
    cards = saved;
    return out;
  };

  it("a card owner gets the compact card in place of the identity row", () => {
    const out = row(player("vet"));
    expect(out).toContain("<player-card");
    expect(out).toContain('size="panel"');
    expect(out).not.toContain("<h2");
    // Built from the card, the roster badge and the card's flag.
    expect(out).toContain('"username":"name-vet"');
    expect(out).toContain('"clanTag":"UN"');
    expect(out).toContain('"flag":"/flags/fr.svg"');
    expect(out).toContain('"level":42');
    expect(out).toContain('"url":"/cosmetics/bg_pacific.webp"');
    expect(out).toContain('"stat":"wins"');
  });

  // The template whose markup holds the close icon, and its @click handler.
  const closeHandler = (value: unknown): ((e: Event) => void) | null => {
    if (Array.isArray(value)) {
      for (const v of value) {
        const found = closeHandler(v);
        if (found) return found;
      }
      return null;
    }
    if (!value || typeof value !== "object" || !("strings" in value)) {
      return null;
    }
    const t = value as { strings: readonly string[]; values: unknown[] };
    if (t.strings.join("").includes('name="close"')) {
      const i = t.strings.findIndex((s) => s.trimEnd().endsWith("@click="));
      if (i >= 0) return t.values[i] as (e: Event) => void;
    }
    for (const v of t.values) {
      const found = closeHandler(v);
      if (found) return found;
    }
    return null;
  };

  it("a card owner's panel keeps its close button, and it hides the panel", () => {
    const out = row(player("vet"));
    expect(out).toContain("<player-card");
    expect(out).toContain('name="close"');
    expect(out).toContain("aria-label=common.close");
    const onClick = closeHandler(
      (panel as any).renderIdentityRow(player("vet"), player("me")),
    );
    expect(onClick).not.toBeNull();
    const hide = vi.spyOn(panel, "hide");
    const event = new Event("click");
    const stop = vi.spyOn(event, "stopPropagation");
    onClick!.call(panel, event);
    expect(hide).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalled();
    expect((panel as any).isVisible).toBe(false);
  });

  it("the card and the close button share one row", () => {
    const out = row(player("vet"));
    const rowStart = out.indexOf('<div class="flex items-center');
    expect(rowStart).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("<player-card")).toBeGreaterThan(rowStart);
    expect(out.indexOf('name="close"')).toBeGreaterThan(
      out.indexOf("</player-card>"),
    );
  });

  it("the identity row without a card keeps its close button too", () => {
    cards = {};
    expect(row(player("vet"))).toContain('name="close"');
  });

  it("is still: never sets animated", () => {
    expect(row(player("vet"))).not.toContain("animated");
  });

  it("keeps the traitor badge and the relation pill", () => {
    const out = row(player("vet"));
    expect(out).toContain("TRAITOR-BADGE");
    expect(out).toContain("RELATION-PILL");
  });

  it("no card (or withheld: anonymised): today's identity row exactly", () => {
    cards = {};
    const out = row(player("vet"));
    expect(out).not.toContain("<player-card");
    expect(out).toContain("<h2");
    expect(out).toBe(todays(player("vet")));
  });

  it("bots and nations: today's identity row, even if a card were sent", () => {
    for (const type of [PlayerType.Bot, PlayerType.Nation]) {
      const out = row(player("vet", type));
      expect(out).not.toContain("<player-card");
      expect(out).toBe(todays(player("vet", type)));
    }
  });

  it("catalogue not loaded: today's identity row", () => {
    catalogue.cached = null;
    const out = row(player("vet"));
    expect(out).not.toContain("<player-card");
    expect(out).toBe(todays(player("vet")));
  });

  it("anonymous names on: others get today's row, your own card stays", () => {
    new UserSettings().toggleRandomName();
    expect(row(player("vet"))).not.toContain("<player-card");
    expect(row(player("me"))).toContain("<player-card");
  });

  it("the card's items go to the equipped-cosmetics row", () => {
    const out = flatten((panel as any).renderCosmeticsRow(player("vet")));
    expect(out).toContain("<equipped-cosmetics-row");
    expect(out).toContain('.card={{"username":"name-vet"');
  });

  it("another player's row can save their look in this game", () => {
    const out = flatten((panel as any).renderCosmeticsRow(player("vet")));
    expect(out).toContain(".lookGameID=game-1");
    expect(out).toContain(".lookClientID=vet");
  });

  it("your own panel has no Get the look tile", () => {
    const out = flatten((panel as any).renderCosmeticsRow(player("me")));
    expect(out).not.toContain(".lookGameID=game-1");
    expect(out).not.toContain(".lookClientID=me");
  });

  it("no card: the equipped-cosmetics row gets none", () => {
    cards = {};
    const out = flatten((panel as any).renderCosmeticsRow(player("vet")));
    expect(out).toContain("<equipped-cosmetics-row");
    expect(out).not.toContain('"username"');
  });

  it("a failed catalogue fetch is retried on a later render", async () => {
    catalogue.cached = null;
    catalogue.fetched = null;
    row(player("vet"));
    row(player("vet"));
    expect(catalogue.fetches).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    row(player("vet"));
    expect(catalogue.fetches).toBe(1);
    // Not straight away: CATALOGUE_RETRY_MS after the failure.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    row(player("vet"));
    expect(catalogue.fetches).toBe(2);
  });

  it("reuses one view per player while nothing changed (no per-tick re-render)", () => {
    const vet = player("vet");
    const first = (panel as any).cardViewFor(vet);
    expect(first).not.toBeNull();
    // Every render asks twice (identity row and cosmetics row), every tick.
    expect((panel as any).cardViewFor(vet)).toBe(first);
    expect((panel as any).cardViewFor(player("vet"))).toBe(first);
    // A new catalogue, or a new card, builds a new view.
    catalogue.cached = { ...COSMETICS };
    const second = (panel as any).cardViewFor(vet);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    cards = { ...cards, vet: { ...CARD, background: undefined } };
    expect((panel as any).cardViewFor(vet).background).toBeNull();
  });

  it("the cache never outlives a withheld card", () => {
    const vet = player("vet");
    expect((panel as any).cardViewFor(vet)).not.toBeNull();
    cards = {};
    expect((panel as any).cardViewFor(vet)).toBeNull();
  });
});
