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

vi.mock("../../../../src/client/UiRuntimeBridge", () => ({
  dispatchUiAction: vi.fn(() => true),
  dispatchUiSnapshot: vi.fn(() => true),
  initDioxusRuntime: vi.fn(async () => ({})),
}));

import { DioxusPlayerModerationModal } from "../../../../src/client/InGameModalBridges";
import { SendKickPlayerIntentEvent } from "../../../../src/client/Transport";
import { PlayerType } from "../../../../src/core/game/Game";
import { PlayerView } from "../../../../src/core/game/GameView";

describe("DioxusPlayerModerationModal - kick confirmation", () => {
  const originalConfirm = globalThis.confirm;

  afterEach(() => {
    vi.clearAllMocks();
    globalThis.confirm = originalConfirm;
  });

  test("emits SendKickPlayerIntentEvent and dispatches kicked when confirmed", () => {
    (globalThis as any).confirm = vi.fn(() => true);

    const modal = new DioxusPlayerModerationModal();
    const eventBus = { emit: vi.fn(), on: vi.fn() };
    (modal as any).eventBus = eventBus;

    const my = { isLobbyCreator: () => true } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
    } as unknown as PlayerView;

    (modal as any).myPlayer = my;
    (modal as any).targetPlayer = other;

    const kickedListener = vi.fn();
    modal.addEventListener("kicked", kickedListener as any);

    (modal as any).handleKick({
      playerId: "2",
      playerName: "Other",
      confirmMessage: "Kick Other?",
    });

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

    const modal = new DioxusPlayerModerationModal();
    const eventBus = { emit: vi.fn(), on: vi.fn() };
    (modal as any).eventBus = eventBus;

    const my = { isLobbyCreator: () => true } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
    } as unknown as PlayerView;

    (modal as any).myPlayer = my;
    (modal as any).targetPlayer = other;

    const kickedListener = vi.fn();
    modal.addEventListener("kicked", kickedListener as any);

    (modal as any).handleKick({
      playerId: "2",
      playerName: "Other",
      confirmMessage: "Kick Other?",
    });

    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(kickedListener).not.toHaveBeenCalled();
  });

  test("does not emit when current player cannot kick target", () => {
    (globalThis as any).confirm = vi.fn(() => true);

    const modal = new DioxusPlayerModerationModal();
    const eventBus = { emit: vi.fn(), on: vi.fn() };
    (modal as any).eventBus = eventBus;

    const my = { isLobbyCreator: () => false } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
      isLobbyCreator: () => false,
    } as unknown as PlayerView;

    (modal as any).myPlayer = my;
    (modal as any).targetPlayer = other;

    (modal as any).handleKick({
      playerId: "2",
      playerName: "Other",
      confirmMessage: "Kick Other?",
    });

    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(globalThis.confirm).not.toHaveBeenCalled();
  });

  test("does not emit when target was already kicked", () => {
    (globalThis as any).confirm = vi.fn(() => true);

    const modal = new DioxusPlayerModerationModal();
    const eventBus = { emit: vi.fn(), on: vi.fn() };
    (modal as any).eventBus = eventBus;

    const my = { isLobbyCreator: () => true } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
      isLobbyCreator: () => false,
    } as unknown as PlayerView;

    (modal as any).myPlayer = my;
    (modal as any).targetPlayer = other;
    (modal as any).alreadyKicked = true;

    (modal as any).handleKick({
      playerId: "2",
      playerName: "Other",
      confirmMessage: "Kick Other?",
    });

    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(globalThis.confirm).not.toHaveBeenCalled();
  });
});
