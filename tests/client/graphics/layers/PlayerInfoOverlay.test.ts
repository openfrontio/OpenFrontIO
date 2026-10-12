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

import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  MockInstance,
  vi,
} from "vitest";
import { PlayerInfoOverlay } from "../../../../src/client/hud/layers/PlayerInfoOverlay";
import {
  DoBoatAttackEvent,
  DoRequestAllianceEvent,
  DoTargetPlayerEvent,
} from "../../../../src/client/InputHandler";

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
    inSpawnPhase: () => false,
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
          actions: async () => ({ buildableUnits: [] }),
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
      expect(out).toContain("sm:w-[598px]");
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

  describe("player action buttons", () => {
    const realWidth = window.innerWidth;
    const realMatchMedia = window.matchMedia;
    let bus: EventBus;
    let emit: MockInstance;

    beforeEach(() => {
      Object.defineProperty(window, "innerWidth", {
        value: 1400,
        configurable: true,
      });
      window.matchMedia = vi.fn(() => ({ matches: false })) as never;
      // A real bus, so the panel sees the actions its buttons and keys send.
      bus = new EventBus();
      emit = vi.spyOn(bus, "emit");
      overlay.eventBus = bus as never;
      overlay.init();
    });

    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        value: realWidth,
        configurable: true,
      });
      window.matchMedia = realMatchMedia;
    });

    // Hovers Bob with the given answers about what I can do to him.
    async function hoverBob(interaction: object, boatReach: boolean) {
      const actions = vi.fn(async () => ({
        canAttack: false,
        canSendEmojiAllPlayers: false,
        interaction,
        buildableUnits: [
          {
            type: UnitType.TransportShip,
            canBuild: boatReach ? 9 : false,
          },
        ],
      }));
      overlay.game = makeGame({
        isFriendly: () => false,
        isAlliedWith: () => false,
        smallID: () => 1,
        actions,
      }) as never;
      overlay.maybeShow(10, 10);
      await Promise.resolve();
      await Promise.resolve();
      return { actions, out: flatten(overlay.render()) };
    }

    // The click handler of the shortcut button with this title.
    function clickHandler(node: unknown, title: string): (() => void) | null {
      if (Array.isArray(node)) {
        for (const n of node) {
          const found = clickHandler(n, title);
          if (found) return found;
        }
        return null;
      }
      if (node && typeof node === "object" && "values" in node) {
        const { values } = node as { values: unknown[] };
        const i = values.indexOf(title);
        if (i !== -1 && typeof values[i + 1] === "function") {
          const fn = values[i + 1] as (e: unknown) => void;
          return () => fn({ stopPropagation: () => {} });
        }
        return clickHandler(values, title);
      }
      return null;
    }

    it("show only what I can do to the hovered player", async () => {
      const { actions, out } = await hoverBob(
        { canSendAllianceRequest: true, canTarget: true },
        true,
      );
      expect(actions).toHaveBeenCalledWith(42, [UnitType.TransportShip]);
      expect(out).toContain("player_panel.send_alliance");
      expect(out).toContain("player_panel.target");
      expect(out).toContain("user_setting.boat_attack");
      expect(out).not.toContain("player_panel.break_alliance");
    });

    it("swap request alliance for break alliance once allied, and hide boat out of reach", async () => {
      const { out } = await hoverBob({ canBreakAlliance: true }, false);
      expect(out).toContain("player_panel.break_alliance");
      expect(out).not.toContain("player_panel.send_alliance");
      expect(out).not.toContain("player_panel.target");
      expect(out).not.toContain("user_setting.boat_attack");
    });

    it("act on the tile the panel shows", async () => {
      await hoverBob({ canSendAllianceRequest: true, canTarget: true }, true);
      const tree = overlay.render();
      clickHandler(tree, "player_panel.send_alliance")!();
      clickHandler(tree, "player_panel.target")!();
      clickHandler(tree, "user_setting.boat_attack")!();

      const sent = emit.mock.calls.map(([e]) => e);
      expect(sent[0]).toBeInstanceOf(DoRequestAllianceEvent);
      expect(sent[1]).toBeInstanceOf(DoTargetPlayerEvent);
      expect(sent[2]).toBeInstanceOf(DoBoatAttackEvent);
      expect(sent.map((e) => e.tile)).toEqual([42, 42, 42]);
      // Alliance and target also name the shown player, so a tile that
      // changes hands meanwhile doesn't redirect them.
      expect(sent[0].playerID).toBe("bob");
      expect(sent[1].playerID).toBe("bob");
    });

    it("drop Send Alliance as soon as I click it", async () => {
      const { actions } = await hoverBob(
        { canSendAllianceRequest: true, canTarget: true },
        false,
      );
      clickHandler(overlay.render(), "player_panel.send_alliance")!();
      overlay.maybeShow(10, 10); // the mouse moves on

      const out = flatten(overlay.render());
      expect(out).not.toContain("player_panel.send_alliance");
      expect(out).toContain("player_panel.target");
      // No new question yet: the game hasn't seen the request.
      expect(actions).toHaveBeenCalledTimes(1);
    });

    it("drop Send Alliance when I press K over the player", async () => {
      await hoverBob({ canSendAllianceRequest: true }, false);
      bus.emit(new DoRequestAllianceEvent());
      expect(flatten(overlay.render())).not.toContain(
        "player_panel.send_alliance",
      );
    });

    it("ignore an answer that was on its way before I acted", async () => {
      await hoverBob({ canSendAllianceRequest: true }, false);
      let answer!: (a: unknown) => void;
      const me = overlay.game.myPlayer() as unknown as {
        actions: ReturnType<typeof vi.fn>;
      };
      me.actions.mockImplementation(
        () => new Promise((resolve) => (answer = resolve)),
      );
      overlay["playerActionsFetchedAt"] = 0;
      overlay.tick(); // asks again while the mouse rests

      bus.emit(new DoRequestAllianceEvent());
      answer({
        interaction: { canSendAllianceRequest: true },
        buildableUnits: [],
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(flatten(overlay.render())).not.toContain(
        "player_panel.send_alliance",
      );
    });

    it("show none while players are still spawning", async () => {
      const actions = vi.fn();
      const game = makeGame({
        isFriendly: () => false,
        isAlliedWith: () => false,
        smallID: () => 1,
        actions,
      });
      game.inSpawnPhase = () => true;
      overlay.game = game as never;
      overlay.maybeShow(10, 10);

      expect(actions).not.toHaveBeenCalled();
      expect(flatten(overlay.render())).not.toContain("player_panel.target");
    });

    it("drop them once the shown tile changes hands", async () => {
      const { actions } = await hoverBob({ canTarget: true }, false);
      overlay["onPanelEnter"](); // the pointer rests on the panel
      const game = overlay.game as unknown as { owner: () => unknown };
      game.owner = () => ({ ...hovered, id: () => "carol" });
      overlay["playerActionsFetchedAt"] = 0;
      overlay.tick();

      expect(actions).toHaveBeenCalledTimes(1);
      expect(flatten(overlay.render())).not.toContain("player_panel.target");
    });

    it("don't ask about my own territory", async () => {
      const me = {
        ...hovered,
        isFriendly: () => true,
        isAlliedWith: () => false,
        actions: vi.fn(),
      };
      const game = makeGame(me);
      game.owner = (() => me) as never;
      overlay.game = game as never;
      overlay.maybeShow(10, 10);
      expect(me.actions).not.toHaveBeenCalled();
      expect(flatten(overlay.render())).not.toContain("player_panel.target");
    });
  });
});
