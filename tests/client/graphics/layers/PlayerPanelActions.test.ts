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

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  renderDuration: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock("@openfront/engine-lib/Format", () => ({
  renderNumber: vi.fn(),
  renderTroops: vi.fn(),
}));

vi.mock("../../../../src/client/components/ui/ActionButton", () => ({
  actionButton: vi.fn((props: unknown) => props),
}));

vi.mock("../../../../src/client/components/LevelBadge", () => ({}));

vi.mock("../../../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(),
  showInGameAlert: vi.fn(),
}));

import {
  AllPlayers,
  GameType,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { flattenedEmojiTable } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import { actionButton } from "../../../../src/client/components/ui/ActionButton";
import { ShowPlayerChatEvent } from "../../../../src/client/hud/layers/ChatModal";
import { ShowPlayerEmojiMenuEvent } from "../../../../src/client/hud/layers/EmojiTable";
import { PlayerPanel } from "../../../../src/client/hud/layers/PlayerPanel";
import {
  CloseViewEvent,
  ContextMenuEvent,
  MouseUpEvent,
  ShowBuildMenuEvent,
  ShowChatMenuEvent,
  ShowEmojiMenuEvent,
  ShowPlayerPanelEvent,
} from "../../../../src/client/InputHandler";
import {
  SendEmbargoIntentEvent,
  SendEmojiIntentEvent,
} from "../../../../src/client/Transport";
import { PlayerView } from "../../../../src/client/view";

const mockActionButton = actionButton as unknown as ReturnType<typeof vi.fn>;

// Labels of the buttons the last render produced, in order.
const renderedLabels = () =>
  mockActionButton.mock.calls.map((c) => (c[0] as { label: string }).label);

const my = {
  id: () => 1,
  displayName: () => "Me",
  type: () => PlayerType.Human,
  clientID: () => "client-1",
  isLobbyCreator: () => false,
} as unknown as PlayerView;

const other = {
  id: () => 2,
  name: () => "Other",
  displayName: () => "[TAG] Other",
  type: () => PlayerType.Human,
  clientID: () => "client-2",
  isLobbyCreator: () => false,
} as unknown as PlayerView;

function makeGame() {
  return {
    myPlayer: () => my,
    config: () => ({
      gameConfig: () => ({ gameType: GameType.Public }),
      isReplay: () => false,
    }),
    gameOver: () => false,
  };
}

describe("PlayerPanel - embargo intents", () => {
  let panel: PlayerPanel;
  let eventBus: EventBus;

  beforeEach(() => {
    panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).isVisible = true;
    (panel as any).g = makeGame();
    eventBus = new EventBus();
    panel.eventBus = eventBus;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("start-embargo button emits a start SendEmbargoIntentEvent and closes the panel", () => {
    const events: SendEmbargoIntentEvent[] = [];
    eventBus.on(SendEmbargoIntentEvent, (e) => events.push(e));

    (panel as any).handleEmbargoClick({ stopPropagation: vi.fn() }, my, other);

    expect(events).toHaveLength(1);
    expect(events[0].target).toBe(other);
    expect(events[0].action).toBe("start");
    expect(panel.isVisible).toBe(false);
  });

  test("stop-embargo button emits a stop SendEmbargoIntentEvent and closes the panel", () => {
    const events: SendEmbargoIntentEvent[] = [];
    eventBus.on(SendEmbargoIntentEvent, (e) => events.push(e));

    (panel as any).handleStopEmbargoClick(
      { stopPropagation: vi.fn() },
      my,
      other,
    );

    expect(events).toHaveLength(1);
    expect(events[0].target).toBe(other);
    expect(events[0].action).toBe("stop");
    expect(panel.isVisible).toBe(false);
  });
});

describe("PlayerPanel - emoji intents", () => {
  let panel: PlayerPanel;
  let eventBus: EventBus;
  let events: SendEmojiIntentEvent[];
  // The panel hands EmojiTable a callback; capture it to simulate a pick.
  let pickEmoji: (emoji: string) => void;

  beforeEach(() => {
    panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).isVisible = true;
    (panel as any).g = makeGame();
    eventBus = new EventBus();
    panel.eventBus = eventBus;
    events = [];
    eventBus.on(SendEmojiIntentEvent, (e) => events.push(e));
    panel.emojiTable = {
      showTable: vi.fn((cb: (emoji: string) => void) => {
        pickEmoji = cb;
      }),
      hideTable: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("emoji on your own panel is broadcast to all players", () => {
    (panel as any).handleEmojiClick({ stopPropagation: vi.fn() }, my, my);
    pickEmoji(flattenedEmojiTable[4]);

    expect(events).toHaveLength(1);
    expect(events[0].recipient).toBe(AllPlayers);
    expect(events[0].emoji).toBe(4);
    expect(panel.emojiTable.hideTable).toHaveBeenCalled();
    expect(panel.isVisible).toBe(false);
  });

  test("emoji on another player's panel is sent to that player", () => {
    (panel as any).handleEmojiClick({ stopPropagation: vi.fn() }, my, other);
    pickEmoji(flattenedEmojiTable[0]);

    expect(events).toHaveLength(1);
    expect(events[0].recipient).toBe(other);
    expect(events[0].emoji).toBe(0);
    expect(panel.isVisible).toBe(false);
  });
});

describe("PlayerPanel - action buttons follow PlayerActions capability flags", () => {
  let panel: PlayerPanel;

  beforeEach(() => {
    panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).isVisible = true;
    (panel as any).g = makeGame();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("all capability flags enabled renders every action for another player", () => {
    (panel as any).actions = {
      canSendEmojiAllPlayers: false,
      canEmbargoAll: true,
      interaction: {
        canSendEmoji: true,
        canTarget: true,
        canEmbargo: true,
        canBreakAlliance: true,
        canSendAllianceRequest: true,
        canDonateGold: true,
        canDonateTroops: true,
      },
    };

    (panel as any).renderActions(my, other);

    const labels = renderedLabels();
    expect(labels).toContain("player_panel.emotes");
    expect(labels).toContain("player_panel.target");
    expect(labels).toContain("player_panel.troops");
    expect(labels).toContain("player_panel.gold");
    // canEmbargo picks the stop-trade button (start-trade otherwise).
    expect(labels).toContain("player_panel.stop_trade");
    expect(labels).not.toContain("player_panel.start_trade");
    expect(labels).toContain("player_panel.break_alliance");
    expect(labels).toContain("player_panel.send_alliance");
  });

  test("no capability flags renders only chat and the start-trade toggle", () => {
    (panel as any).actions = { interaction: {} };

    (panel as any).renderActions(my, other);

    const labels = renderedLabels();
    expect(labels).toContain("player_panel.chat");
    expect(labels).toContain("player_panel.start_trade");
    expect(labels).not.toContain("player_panel.emotes");
    expect(labels).not.toContain("player_panel.target");
    expect(labels).not.toContain("player_panel.break_alliance");
    expect(labels).not.toContain("player_panel.send_alliance");
  });

  test("own panel uses canSendEmojiAllPlayers instead of the interaction flag", () => {
    (panel as any).actions = {
      canSendEmojiAllPlayers: true,
      canEmbargoAll: true,
      interaction: { canSendEmoji: false },
    };

    (panel as any).renderActions(my, my);

    expect(renderedLabels()).toContain("player_panel.emotes");

    mockActionButton.mockClear();
    (panel as any).actions = {
      canSendEmojiAllPlayers: false,
      canEmbargoAll: true,
      interaction: { canSendEmoji: true },
    };

    (panel as any).renderActions(my, my);

    expect(renderedLabels()).not.toContain("player_panel.emotes");
  });
});

describe("PlayerPanel - openSendGoldModal suppressNextHide", () => {
  const actions = {
    canAttack: false,
    buildableUnits: [],
    canSendEmojiAllPlayers: false,
  };

  test("swallows the first MouseUpEvent by default (radial menu click)", () => {
    const panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).g = makeGame();
    const eventBus = new EventBus();
    panel.initEventBus(eventBus);
    panel.init();

    panel.openSendGoldModal(actions, 7, other);
    expect(panel.isVisible).toBe(true);

    eventBus.emit(new MouseUpEvent(10, 20));
    expect(panel.isVisible).toBe(true);

    eventBus.emit(new MouseUpEvent(10, 20));
    expect(panel.isVisible).toBe(false);
  });

  test("closes on the first MouseUpEvent when suppressNextHide is false (keybind)", () => {
    const panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).g = makeGame();
    const eventBus = new EventBus();
    panel.initEventBus(eventBus);
    panel.init();

    panel.openSendGoldModal(actions, 7, other, false);
    expect(panel.isVisible).toBe(true);

    eventBus.emit(new MouseUpEvent(10, 20));
    expect(panel.isVisible).toBe(false);
  });

  test("show() resets suppressNextHide and send modal state after openSendGoldModal", () => {
    const panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).g = makeGame();
    const eventBus = new EventBus();
    panel.initEventBus(eventBus);
    panel.init();

    panel.openSendGoldModal(actions, 7, other);
    panel.hide();

    panel.show(actions, 7);
    expect(panel.isVisible).toBe(true);
    expect((panel as any).sendMode).toBe("none");
    expect((panel as any).sendTarget).toBeNull();

    eventBus.emit(new MouseUpEvent(10, 20));
    expect(panel.isVisible).toBe(false);
  });
});

describe("PlayerPanel - ShowPlayerPanelEvent keybind", () => {
  const TILE = 7;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function setupKeybind({
    isPlayer = true,
    isSpectator = false,
    inSpawnPhase = false,
    isValidCoord = true,
    panelVisible = false,
  } = {}) {
    const bus = new EventBus();
    const target = {
      isPlayer: () => isPlayer,
    } as unknown as PlayerView;
    const actions = {
      canAttack: true,
      buildableUnits: [],
      canSendEmojiAllPlayers: true,
      interaction: { canSendAllianceRequest: true },
    };
    const myPlayer = {
      actions: vi.fn(async () => actions),
    };
    const game = {
      isSpectator: () => isSpectator,
      inSpawnPhase: () => inSpawnPhase,
      myPlayer: () => myPlayer,
      isValidCoord: () => isValidCoord,
      ref: () => TILE,
      owner: () => target,
      config: () => ({
        gameConfig: () => ({ gameType: GameType.Public }),
        isReplay: () => false,
      }),
      gameOver: () => false,
    };
    const transformHandler = {
      screenToWorldCoordinates: vi.fn(() => ({ x: 3, y: 4 })),
    };
    const panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    panel.g = game as any;
    panel.transformHandler = transformHandler as any;
    panel.initEventBus(bus);
    panel.isVisible = panelVisible;
    return { bus, game, actions, myPlayer, transformHandler, panel };
  }

  test("opens the player panel for the player under the cursor and closes other views", async () => {
    const { bus, actions, transformHandler, panel } = setupKeybind();
    const showSpy = vi.spyOn(panel, "show");
    let closedViews = 0;
    bus.on(CloseViewEvent, () => closedViews++);

    bus.emit(new ShowPlayerPanelEvent(50, 60));
    await flush();

    expect(transformHandler.screenToWorldCoordinates).toHaveBeenCalledWith(
      50,
      60,
    );
    expect(closedViews).toBe(1);
    expect(showSpy).toHaveBeenCalledExactlyOnceWith(actions, TILE);
    expect(panel.isVisible).toBe(true);
  });

  test("closes the player panel when it is already visible, even before the first mousemove", async () => {
    const { bus, myPlayer, panel } = setupKeybind({ panelVisible: true });
    const hideSpy = vi.spyOn(panel, "hide");
    const showSpy = vi.spyOn(panel, "show");

    bus.emit(new ShowPlayerPanelEvent(null, null));
    await flush();

    expect(hideSpy).toHaveBeenCalledOnce();
    expect(showSpy).not.toHaveBeenCalled();
    expect(myPlayer.actions).not.toHaveBeenCalled();
    expect(panel.isVisible).toBe(false);
  });

  test("opens the read-only player panel directly for spectators", async () => {
    const { bus, myPlayer, panel } = setupKeybind({ isSpectator: true });
    const showSpy = vi.spyOn(panel, "show");

    bus.emit(new ShowPlayerPanelEvent(50, 60));
    await flush();

    expect(myPlayer.actions).not.toHaveBeenCalled();
    expect(showSpy).toHaveBeenCalledExactlyOnceWith(
      {
        canAttack: false,
        buildableUnits: [],
        canSendEmojiAllPlayers: false,
      },
      TILE,
    );
    expect(panel.isVisible).toBe(true);
  });

  test.each([
    ["during the spawn phase", { inSpawnPhase: true }, 50, 60],
    ["over unowned territory", { isPlayer: false }, 50, 60],
    ["at an invalid cursor position", { isValidCoord: false }, 50, 60],
    ["before the first mousemove", {}, null, null],
  ])("does not open the player panel %s", async (_, opts, x, y) => {
    const { bus, panel } = setupKeybind(opts);
    const showSpy = vi.spyOn(panel, "show");

    bus.emit(new ShowPlayerPanelEvent(x, y));
    await flush();

    expect(showSpy).not.toHaveBeenCalled();
    expect(panel.isVisible).toBe(false);
  });

  test.each([
    ["CloseViewEvent", () => new CloseViewEvent()],
    ["MouseUpEvent", () => new MouseUpEvent(10, 20)],
    ["ContextMenuEvent", () => new ContextMenuEvent(10, 20)],
    ["ShowBuildMenuEvent", () => new ShowBuildMenuEvent(10, 20)],
    ["ShowEmojiMenuEvent", () => new ShowEmojiMenuEvent(10, 20)],
    ["ShowChatMenuEvent", () => new ShowChatMenuEvent(10, 20)],
    ["ShowPlayerChatEvent", () => new ShowPlayerChatEvent(other)],
    ["ShowPlayerEmojiMenuEvent", () => new ShowPlayerEmojiMenuEvent(other)],
  ])(
    "drops a pending player panel open when %s fires before actions resolve",
    async (_, makeEvent) => {
      const { bus, panel } = setupKeybind();
      const showSpy = vi.spyOn(panel, "show");

      bus.emit(new ShowPlayerPanelEvent(50, 60));
      bus.emit(makeEvent());
      await flush();

      expect(showSpy).not.toHaveBeenCalled();
      expect(panel.isVisible).toBe(false);
    },
  );

  test("a second press before actions resolve cancels the pending open", async () => {
    const { bus, myPlayer, panel } = setupKeybind();
    const showSpy = vi.spyOn(panel, "show");

    bus.emit(new ShowPlayerPanelEvent(50, 60));
    bus.emit(new ShowPlayerPanelEvent(50, 60));
    await flush();

    expect(myPlayer.actions).toHaveBeenCalledOnce();
    expect(showSpy).not.toHaveBeenCalled();
    expect(panel.isVisible).toBe(false);
  });

  test("does not open the player panel if the tile changes owner before actions resolve", async () => {
    const { bus, game, panel } = setupKeybind();
    const showSpy = vi.spyOn(panel, "show");
    const newOwner = { isPlayer: () => true } as unknown as PlayerView;

    bus.emit(new ShowPlayerPanelEvent(50, 60));
    game.owner = () => newOwner;
    await flush();

    expect(showSpy).not.toHaveBeenCalled();
    expect(panel.isVisible).toBe(false);
  });
});
