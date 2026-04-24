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

import { actionButton } from "../../../../src/client/components/ui/ActionButton";
import { PlayerModerationModal } from "../../../../src/client/graphics/layers/PlayerModerationModal";
import { PlayerPanel } from "../../../../src/client/graphics/layers/PlayerPanel";
import { SendKickPlayerIntentEvent } from "../../../../src/client/Transport";
import { PlayerType } from "../../../../src/core/game/Game";
import { PlayerView } from "../../../../src/core/game/GameView";

describe("PlayerPanel - kick player moderation", () => {
  let panel: PlayerPanel;
  const originalConfirm = globalThis.confirm;

  beforeEach(() => {
    panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).isVisible = true;
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

    (actionButton as unknown as ReturnType<typeof vi.fn>).mockClear();
    (panel as any).renderModeration(my, other, false);
    expect(actionButton).toHaveBeenCalledTimes(1);
    expect(
      (actionButton as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({
      label: "player_panel.moderation",
      title: "player_panel.moderation",
      type: "red",
    });

    (actionButton as unknown as ReturnType<typeof vi.fn>).mockClear();
    (panel as any).kickedPlayerIDs.add("2");
    (panel as any).renderModeration(my, other, false);
    expect(actionButton).toHaveBeenCalledTimes(1);

    const notCreator = { isLobbyCreator: () => false } as unknown as PlayerView;
    (actionButton as unknown as ReturnType<typeof vi.fn>).mockClear();
    (panel as any).kickedPlayerIDs.clear();
    (panel as any).renderModeration(notCreator, other, false);
    expect(actionButton).not.toHaveBeenCalled();
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

    (actionButton as unknown as ReturnType<typeof vi.fn>).mockClear();
    (panel as any).renderModeration(notCreator, other, true);
    expect(actionButton).toHaveBeenCalledTimes(1);
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

describe("PlayerModerationModal - kick confirmation", () => {
  const originalConfirm = globalThis.confirm;

  afterEach(() => {
    vi.clearAllMocks();
    globalThis.confirm = originalConfirm;
  });

  test("emits SendKickPlayerIntentEvent and dispatches kicked when confirmed", () => {
    (globalThis as any).confirm = vi.fn(() => true);

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

    (modal as any).handleKickClick({ stopPropagation: vi.fn() });

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const event = eventBus.emit.mock.calls[0][0] as SendKickPlayerIntentEvent;
    expect(event).toBeInstanceOf(SendKickPlayerIntentEvent);
    expect(event.target).toBe("client-2");

    expect(kickedListener).toHaveBeenCalledTimes(1);
    const kickedEvent = kickedListener.mock.calls[0][0] as CustomEvent;
    expect(kickedEvent.detail).toEqual({ playerId: "2" });
  });

  test("does not emit when confirmation is cancelled", () => {
    (globalThis as any).confirm = vi.fn(() => false);

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

    (modal as any).handleKickClick({ stopPropagation: vi.fn() });

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
