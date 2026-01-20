vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  LitElement: class {
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
import { PlayerPanel } from "../../../../src/client/graphics/layers/PlayerPanel";
import { SendKickPlayerIntentEvent } from "../../../../src/client/Transport";
import { PlayerType } from "../../../../src/core/game/Game";
import { GameView, PlayerView } from "../../../../src/core/game/GameView";

describe("PlayerPanel - kick player moderation", () => {
  let panel: PlayerPanel;
  let eventBus: { emit: ReturnType<typeof vi.fn> };
  const originalConfirm = globalThis.confirm;

  beforeEach(() => {
    panel = new PlayerPanel();
    eventBus = { emit: vi.fn() };

    panel.eventBus = eventBus as any;
    (panel as any).requestUpdate = vi.fn();
    (panel as any).isVisible = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
    globalThis.confirm = originalConfirm;
  });

  test("does nothing if I am not the lobby creator", () => {
    (globalThis as any).confirm = vi.fn(() => true);

    const my = { isLobbyCreator: () => false } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
    } as unknown as PlayerView;

    panel.g = { myPlayer: () => my } as unknown as GameView;

    (panel as any).handleKickClick({ stopPropagation: vi.fn() }, other);

    expect(eventBus.emit).not.toHaveBeenCalled();
    expect((panel as any).kickedPlayerIDs.has("2")).toBe(false);
    expect((panel as any).isVisible).toBe(true);
  });

  test("emits SendKickPlayerIntentEvent, records kick, and hides when confirmed", () => {
    (globalThis as any).confirm = vi.fn(() => true);

    const my = { isLobbyCreator: () => true } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
    } as unknown as PlayerView;

    panel.g = { myPlayer: () => my } as unknown as GameView;

    (panel as any).handleKickClick({ stopPropagation: vi.fn() }, other);

    expect((panel as any).kickedPlayerIDs.has("2")).toBe(true);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const event = eventBus.emit.mock.calls[0][0] as SendKickPlayerIntentEvent;
    expect(event).toBeInstanceOf(SendKickPlayerIntentEvent);
    expect(event.target).toBe("client-2");
    expect((panel as any).isVisible).toBe(false);
  });

  test("does not kick or emit when confirmation is cancelled", () => {
    (globalThis as any).confirm = vi.fn(() => false);

    const my = { isLobbyCreator: () => true } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
    } as unknown as PlayerView;

    panel.g = { myPlayer: () => my } as unknown as GameView;

    (panel as any).handleKickClick({ stopPropagation: vi.fn() }, other);

    expect(eventBus.emit).not.toHaveBeenCalled();
    expect((panel as any).kickedPlayerIDs.has("2")).toBe(false);
    expect((panel as any).isVisible).toBe(true);
  });

  test("renders kick action only when allowed or already kicked", () => {
    const my = { isLobbyCreator: () => true } as unknown as PlayerView;
    const other = {
      id: () => 2,
      name: () => "Other",
      type: () => PlayerType.Human,
      clientID: () => "client-2",
    } as unknown as PlayerView;

    (actionButton as unknown as ReturnType<typeof vi.fn>).mockClear();
    (panel as any).renderModeration(my, other);
    expect(actionButton).toHaveBeenCalledTimes(1);
    expect(
      (actionButton as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({
      disabled: false,
      label: "player_panel.kick",
      title: "player_panel.kick",
      type: "red",
    });

    // Once kicked, the button stays visible but is disabled + label changes.
    (actionButton as unknown as ReturnType<typeof vi.fn>).mockClear();
    (panel as any).kickedPlayerIDs.add("2");
    (panel as any).renderModeration(my, other);
    expect(actionButton).toHaveBeenCalledTimes(1);
    expect(
      (actionButton as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({
      disabled: true,
      label: "player_panel.kicked",
      title: "player_panel.kicked",
      type: "red",
    });

    // Not allowed and not kicked => no kick action rendered.
    const notCreator = { isLobbyCreator: () => false } as unknown as PlayerView;
    (actionButton as unknown as ReturnType<typeof vi.fn>).mockClear();
    (panel as any).kickedPlayerIDs.clear();
    (panel as any).renderModeration(notCreator, other);
    expect(actionButton).not.toHaveBeenCalled();
  });
});
