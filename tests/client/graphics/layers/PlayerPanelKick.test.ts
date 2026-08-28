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
  renderNumber: vi.fn(),
  renderTroops: vi.fn(),
}));

vi.mock("../../../../src/client/components/ui/ActionButton", () => ({
  actionButton: vi.fn((props: unknown) => props),
}));

vi.mock("../../../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(),
  showInGameAlert: vi.fn(),
}));

import { actionButton } from "../../../../src/client/components/ui/ActionButton";
import { PlayerModerationModal } from "../../../../src/client/hud/layers/PlayerModerationModal";
import { PlayerPanel } from "../../../../src/client/hud/layers/PlayerPanel";
import { PlayerReportModal } from "../../../../src/client/hud/layers/PlayerReportModal";
import { showInGameConfirm } from "../../../../src/client/InGameModal";
import {
  SendKickPlayerIntentEvent,
  SendPlayerReportEvent,
} from "../../../../src/client/Transport";
import { PlayerView } from "../../../../src/client/view";
import { GameType, PlayerType } from "../../../../src/core/game/Game";

const mockActionButton = actionButton as unknown as ReturnType<typeof vi.fn>;

// Labels of the buttons the last renderModeration call produced, in order.
const renderedLabels = () =>
  mockActionButton.mock.calls.map((c) => (c[0] as { label: string }).label);

function gameOfType(gameType: GameType) {
  return { config: () => ({ gameConfig: () => ({ gameType }) }) };
}

describe("PlayerPanel - kick player moderation", () => {
  let panel: PlayerPanel;
  const originalConfirm = globalThis.confirm;

  beforeEach(() => {
    panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).isVisible = true;
    (panel as any).g = gameOfType(GameType.Public);
  });

  afterEach(() => {
    vi.clearAllMocks();
    globalThis.confirm = originalConfirm;
  });

  test("renders moderation action only when allowed or already kicked", () => {
    const my = { isLobbyCreator: () => true } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      displayName: () => "[TAG] Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
    } as unknown as PlayerView;

    // The row also carries the report button, which anyone gets.
    mockActionButton.mockClear();
    (panel as any).renderModeration(my, other, false);
    expect(renderedLabels()).toEqual([
      "player_panel.report",
      "player_panel.moderation",
    ]);
    expect(mockActionButton.mock.calls[1][0]).toMatchObject({
      label: "player_panel.moderation",
      title: "player_panel.moderation",
      type: "red",
    });

    mockActionButton.mockClear();
    (panel as any).kickedPlayerIDs.add("2");
    (panel as any).renderModeration(my, other, false);
    expect(renderedLabels()).toContain("player_panel.moderation");

    const notCreator = { isLobbyCreator: () => false } as unknown as PlayerView;
    mockActionButton.mockClear();
    (panel as any).kickedPlayerIDs.clear();
    (panel as any).renderModeration(notCreator, other, false);
    expect(renderedLabels()).not.toContain("player_panel.moderation");
  });

  test("renders moderation action when isAdmin=true even if not lobby creator", () => {
    const notCreator = { isLobbyCreator: () => false } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      displayName: () => "[TAG] Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
    } as unknown as PlayerView;

    mockActionButton.mockClear();
    (panel as any).renderModeration(notCreator, other, true);
    expect(renderedLabels()).toContain("player_panel.moderation");
  });

  test("opens moderation modal and hides after a kick", () => {
    const other = {
      id: () => 2,
      name: () => "Other",
      displayName: () => "[TAG] Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
    } as unknown as PlayerView;

    (panel as any).openModeration({ stopPropagation: vi.fn() }, other);
    expect((panel as any).moderationTarget).toBe(other);
    expect((panel as any).suppressNextHide).toBe(true);

    (panel as any).handleModerationKicked(
      new CustomEvent("kicked", { detail: { playerId: "2" } }),
    );

    expect((panel as any).kickedPlayerIDs.has("2")).toBe(true);
    expect((panel as any).moderationTarget).toBe(null);
    expect((panel as any).isVisible).toBe(false);
  });
});

describe("PlayerPanel - report player", () => {
  let panel: PlayerPanel;
  const me = { isLobbyCreator: () => false } as unknown as PlayerView;
  const other = {
    id: () => 2,
    displayName: () => "Other",
    type: () => PlayerType.Human,
    clientID: () => "client-2",
    isLobbyCreator: () => false,
  } as unknown as PlayerView;

  beforeEach(() => {
    panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).g = gameOfType(GameType.Public);
    mockActionButton.mockClear();
  });

  test("anyone can report another human in a multiplayer game", () => {
    (panel as any).renderModeration(me, other, false);
    expect(renderedLabels()).toEqual(["player_panel.report"]);
    expect(mockActionButton.mock.calls[0][0]).toMatchObject({
      type: "red",
      disabled: false,
    });
  });

  test("no report button in singleplayer, for yourself, or for a nation", () => {
    // Singleplayer records are client-authored; the API ignores their reports.
    (panel as any).g = gameOfType(GameType.Singleplayer);
    (panel as any).renderModeration(me, other, false);
    expect(mockActionButton).not.toHaveBeenCalled();

    (panel as any).g = gameOfType(GameType.Public);
    (panel as any).renderModeration(other, other, false);
    expect(mockActionButton).not.toHaveBeenCalled();

    const nation = {
      ...other,
      type: () => PlayerType.Nation,
      clientID: () => null,
    } as unknown as PlayerView;
    (panel as any).renderModeration(me, nation, false);
    expect(mockActionButton).not.toHaveBeenCalled();
  });

  test("locks the button once the player has been reported", () => {
    (panel as any).openReport({ stopPropagation: vi.fn() }, other);
    expect((panel as any).reportTarget).toBe(other);
    expect((panel as any).suppressNextHide).toBe(true);

    (panel as any).handleReported(
      new CustomEvent("reported", { detail: { playerId: "2" } }),
    );
    expect((panel as any).reportTarget).toBe(null);

    (panel as any).renderModeration(me, other, false);
    expect(mockActionButton.mock.calls[0][0]).toMatchObject({
      label: "player_panel.reported",
      disabled: true,
    });
  });
});

describe("PlayerReportModal", () => {
  const other = {
    id: () => 2,
    displayName: () => "Other",
    type: () => PlayerType.Human,
    clientID: () => "client-2",
  } as unknown as PlayerView;

  function makeModal() {
    const modal = new PlayerReportModal();
    const eventBus = { emit: vi.fn() };
    modal.eventBus = eventBus as any;
    modal.target = other;
    const reported = vi.fn();
    modal.addEventListener("reported", reported as any);
    return { modal, eventBus, reported };
  }

  test("submits the chosen reason for the target's clientID", () => {
    const { modal, eventBus, reported } = makeModal();
    (modal as any).reason = "teaming";

    (modal as any).handleSubmit({ stopPropagation: vi.fn() });

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const event = eventBus.emit.mock.calls[0][0] as SendPlayerReportEvent;
    expect(event).toBeInstanceOf(SendPlayerReportEvent);
    expect(event.reported).toBe("client-2");
    expect(event.reason).toBe("teaming");
    expect((reported.mock.calls[0][0] as CustomEvent).detail).toEqual({
      playerId: "2",
    });
  });

  test("does nothing until a reason is chosen", () => {
    const { modal, eventBus, reported } = makeModal();
    (modal as any).handleSubmit({ stopPropagation: vi.fn() });
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(reported).not.toHaveBeenCalled();
  });
});

describe("PlayerModerationModal - kick confirmation", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("emits SendKickPlayerIntentEvent and dispatches kicked when confirmed", async () => {
    (showInGameConfirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const modal = new PlayerModerationModal();
    const eventBus = { emit: vi.fn() };
    const my = { isLobbyCreator: () => true } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      displayName: () => "[TAG] Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
    } as unknown as PlayerView;

    modal.eventBus = eventBus as any;
    modal.myPlayer = my;
    modal.target = other;

    const kickedListener = vi.fn();
    modal.addEventListener("kicked", kickedListener as any);

    await (modal as any).handleKickClick({ stopPropagation: vi.fn() });

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const event = eventBus.emit.mock.calls[0][0] as SendKickPlayerIntentEvent;
    expect(event).toBeInstanceOf(SendKickPlayerIntentEvent);
    expect(event.target).toBe("client-2");

    expect(kickedListener).toHaveBeenCalledTimes(1);
    const kickedEvent = kickedListener.mock.calls[0][0] as CustomEvent;
    expect(kickedEvent.detail).toEqual({ playerId: "2" });
  });

  test("does not emit when confirmation is cancelled", async () => {
    (showInGameConfirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const modal = new PlayerModerationModal();
    const eventBus = { emit: vi.fn() };
    const my = { isLobbyCreator: () => true } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      displayName: () => "[TAG] Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
    } as unknown as PlayerView;

    modal.eventBus = eventBus as any;
    modal.myPlayer = my;
    modal.target = other;

    const kickedListener = vi.fn();
    modal.addEventListener("kicked", kickedListener as any);

    await (modal as any).handleKickClick({ stopPropagation: vi.fn() });

    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(kickedListener).not.toHaveBeenCalled();
  });

  describe("canKick", () => {
    function makeModal(isAdmin: boolean) {
      const modal = new PlayerModerationModal();
      modal.isAdmin = isAdmin;
      return modal;
    }

    const nonCreator = { isLobbyCreator: () => false } as unknown as PlayerView;
    const creator = { isLobbyCreator: () => true } as unknown as PlayerView;
    const humanOther = {
      type: () => PlayerType.Human,
      clientID: () => "client-other",
    } as unknown as PlayerView;

    test("admin non-creator can kick a valid other player", () => {
      const modal = makeModal(true);
      expect((modal as any).canKick(nonCreator, humanOther)).toBe(true);
    });

    test("non-admin non-creator cannot kick", () => {
      const modal = makeModal(false);
      expect((modal as any).canKick(nonCreator, humanOther)).toBe(false);
    });

    test("admin cannot kick themselves", () => {
      const modal = makeModal(true);
      // same object reference → other === my
      expect((modal as any).canKick(nonCreator, nonCreator)).toBe(false);
    });

    test("lobby creator can kick a valid other player", () => {
      const modal = makeModal(false);
      expect((modal as any).canKick(creator, humanOther)).toBe(true);
    });
  });
});
