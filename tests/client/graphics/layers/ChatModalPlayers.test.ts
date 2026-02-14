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

const { dispatchUiSnapshotMock } = vi.hoisted(() => ({
  dispatchUiSnapshotMock: vi.fn(() => true),
}));

vi.mock("../../../../src/client/UiRuntimeBridge", () => ({
  dispatchUiAction: vi.fn(() => true),
  dispatchUiSnapshot: dispatchUiSnapshotMock,
  initDioxusRuntime: vi.fn(async () => ({})),
}));

import { DioxusChatModal } from "../../../../src/client/InGameModalBridges";
import { PlayerType } from "../../../../src/core/game/Game";
import { PlayerView } from "../../../../src/core/game/GameView";
import { UI_RUNTIME_SNAPSHOTS } from "../../../../src/client/runtime/UiRuntimeProtocol";

describe("DioxusChatModal player list sync", () => {
  beforeEach(() => {
    dispatchUiSnapshotMock.mockClear();
  });

  function makePlayer(
    id: number,
    name: string,
    opts: { alive: boolean; type: PlayerType },
  ): PlayerView {
    return {
      id: () => id,
      name: () => name,
      isAlive: () => opts.alive,
      data: { playerType: opts.type },
    } as unknown as PlayerView;
  }

  test("filters out bots/dead players and deduplicates unchanged updates", () => {
    const modal = new DioxusChatModal();

    (modal as any).isWasmInitialized = true;

    const aliveHuman = makePlayer(1, "Alive", {
      alive: true,
      type: PlayerType.Human,
    });
    const aliveBot = makePlayer(2, "Bot", {
      alive: true,
      type: PlayerType.Bot,
    });
    const deadHuman = makePlayer(3, "Dead", {
      alive: false,
      type: PlayerType.Human,
    });

    (modal as any).updatePlayers([aliveHuman, aliveBot, deadHuman]);
    expect(dispatchUiSnapshotMock).toHaveBeenCalledTimes(1);
    const firstSnapshotCall = (dispatchUiSnapshotMock.mock.calls[0] as any[])[0];
    expect(firstSnapshotCall).toEqual({
      type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameChatModalPlayers,
      payload: {
        players: [{ id: "1", name: "Alive" }],
      },
    });

    (modal as any).updatePlayers([aliveHuman, aliveBot, deadHuman]);
    expect(dispatchUiSnapshotMock).toHaveBeenCalledTimes(1);
  });

  test("tick syncs players only while visible", () => {
    const modal = new DioxusChatModal();
    const aliveHuman = makePlayer(1, "Alive", {
      alive: true,
      type: PlayerType.Human,
    });

    (modal as any).isWasmInitialized = true;
    (modal as any).game = { players: () => [aliveHuman] };

    (modal as any).isVisible = false;
    modal.tick();
    expect(dispatchUiSnapshotMock).not.toHaveBeenCalled();

    (modal as any).isVisible = true;
    modal.tick();
    expect(dispatchUiSnapshotMock).toHaveBeenCalledTimes(1);
  });
});
