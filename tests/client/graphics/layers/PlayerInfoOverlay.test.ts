/**
 * Hovering an owned tile must show the owner's info card, and the name color
 * must reflect the local player's relation to them (friendly = green).
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

vi.mock("../../../../src/client/Utils", () => ({
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

vi.mock("../../../../src/client/hud/PlayerIcons", () => ({
  EMOJI_ICON_KIND: "emoji",
  IMAGE_ICON_KIND: "image",
  getFirstPlacePlayer: vi.fn(() => null),
  getPlayerIcons: vi.fn(() => []),
}));

import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerInfoOverlay } from "../../../../src/client/hud/layers/PlayerInfoOverlay";

// Flattens the mocked-html template tree into one string for assertions.
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

describe("PlayerInfoOverlay", () => {
  let overlay: PlayerInfoOverlay;

  const hovered = {
    isPlayer: () => true,
    profile: () => Promise.resolve(null),
    getTraitorRemainingTicks: () => 0,
    outgoingAttacks: () => [],
    troops: () => 100,
    gold: () => 0n,
    type: () => PlayerType.Human,
    team: () => null,
    displayName: () => "Bob",
    cosmetics: {},
    id: () => "bob",
    smallID: () => 2,
  };

  const makeGame = (myPlayer: unknown) => ({
    isValidCoord: () => true,
    ref: () => 42,
    owner: () => hovered,
    myPlayer: () => myPlayer,
    config: () => ({
      isUnitDisabled: () => true,
      maxTroops: () => 1000,
    }),
    teamClanTag: () => undefined,
  });

  beforeEach(() => {
    overlay = new PlayerInfoOverlay();
    overlay.eventBus = { on: vi.fn() } as never;
    overlay.transform = {
      screenToWorldCoordinates: () => ({ x: 5, y: 5 }),
    } as never;
    overlay.init();
  });

  it("shows the hovered player's card with a green name for a friend", () => {
    overlay.game = makeGame({
      isFriendly: () => true,
      isAlliedWith: () => false,
      smallID: () => 1,
    }) as never;

    overlay.maybeShow(10, 10);
    const out = flatten(overlay.render());

    expect(out).toContain("opacity-100 visible");
    expect(out).toContain("Bob");
    expect(out).toContain("text-green-500");
  });

  it("shows a white name when there is no local player", () => {
    overlay.game = makeGame(null) as never;

    overlay.maybeShow(10, 10);
    const out = flatten(overlay.render());

    expect(out).toContain("Bob");
    expect(out).toContain("text-white");
    expect(out).not.toContain("text-green-500");
  });

  it("keeps its target while the pointer is on the panel", () => {
    const game = makeGame({
      isFriendly: () => false,
      isAlliedWith: () => false,
      smallID: () => 1,
    });
    overlay.game = game as never;
    overlay.maybeShow(10, 10);
    expect(flatten(overlay.render())).toContain("Bob");

    // The pointer moves onto the panel, over Carol's land.
    overlay["onPanelEnter"]();
    game.owner = (() => ({
      ...hovered,
      displayName: () => "Carol",
      id: () => "carol",
      smallID: () => 3,
    })) as never;
    overlay["onMouseEvent"]({ x: 400, y: 5 } as never);
    expect(flatten(overlay.render())).toContain("Bob");

    // Off the panel, mouse moves retarget again.
    overlay["onPanelLeave"]();
    overlay["lastMouseUpdate"] = 0;
    overlay["onMouseEvent"]({ x: 400, y: 5 } as never);
    expect(flatten(overlay.render())).toContain("Carol");
  });

  describe("chat and emoji buttons", () => {
    const realWidth = window.innerWidth;
    const realMatchMedia = window.matchMedia;

    function showWith(width: number, touch: boolean, me?: unknown): string {
      Object.defineProperty(window, "innerWidth", {
        value: width,
        configurable: true,
      });
      window.matchMedia = vi.fn(() => ({ matches: touch })) as never;
      const game = makeGame(
        me ?? {
          isFriendly: () => false,
          isAlliedWith: () => false,
          smallID: () => 1,
        },
      );
      // Hovering my own land: the owner is me.
      if (me) game.owner = (() => me) as never;
      overlay.game = game as never;
      overlay.maybeShow(10, 10);
      return flatten(overlay.render());
    }

    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        value: realWidth,
        configurable: true,
      });
      window.matchMedia = realMatchMedia;
    });

    it("show on wide screens with a mouse, widening the panel", () => {
      const out = showWith(1200, false);
      expect(out).toContain("player_panel.chat");
      expect(out).toContain("player_panel.emotes");
      expect(out).toContain("sm:w-[548px]");
    });

    it("leave out chat when hovering my own territory", () => {
      const out = showWith(1200, false, {
        ...hovered,
        isFriendly: () => true,
        isAlliedWith: () => false,
      });
      expect(out).not.toContain("player_panel.chat");
      expect(out).toContain("player_panel.emotes");
    });

    it("hide below 1200px so the panel doesn't cover the leaderboard", () => {
      const out = showWith(1199, false);
      expect(out).not.toContain("player_panel.chat");
      expect(out).not.toContain("player_panel.emotes");
      expect(out).toContain("sm:w-[500px]");
    });

    it("hide on touch devices", () => {
      const out = showWith(1400, true);
      expect(out).not.toContain("player_panel.chat");
      expect(out).not.toContain("player_panel.emotes");
      expect(out).toContain("sm:w-[500px]");
    });
  });
});
