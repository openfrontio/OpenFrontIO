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
}));

const sessionRuntimeMocks = vi.hoisted(() => ({
  ensureUiSessionRuntimeStarted: vi.fn(() => Promise.resolve()),
  reportUiModalState: vi.fn(() => true),
  requestUiModalClose: vi.fn(() => true),
}));

vi.mock("../../../../src/client/runtime/UiSessionRuntime", () => ({
  ensureUiSessionRuntimeStarted: sessionRuntimeMocks.ensureUiSessionRuntimeStarted,
  reportUiModalState: sessionRuntimeMocks.reportUiModalState,
  requestUiModalClose: sessionRuntimeMocks.requestUiModalClose,
  UI_SESSION_RUNTIME_EVENTS: {
    modalClose: "ui-session-runtime:modal-close",
  },
}));

const runtimeBridgeMocks = vi.hoisted(() => ({
  dispatchUiAction: vi.fn(() => true),
  dispatchUiSnapshot: vi.fn(() => true),
}));

vi.mock("../../../../src/client/UiRuntimeBridge", () => ({
  initDioxusRuntime: vi.fn(async () => ({})),
  dispatchUiAction: runtimeBridgeMocks.dispatchUiAction,
  dispatchUiSnapshot: runtimeBridgeMocks.dispatchUiSnapshot,
}));

import { DioxusSendResourceModal } from "../../../../src/client/InGameModalBridges";
import { PlayerView } from "../../../../src/core/game/GameView";

describe("DioxusSendResourceModal session runtime routing", () => {
  const makePlayer = (opts: {
    name: string;
    troops: number;
    gold: number;
    alive: boolean;
  }): PlayerView =>
    ({
      name: () => opts.name,
      troops: () => BigInt(opts.troops),
      gold: () => BigInt(opts.gold),
      isAlive: () => opts.alive,
    }) as unknown as PlayerView;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("reports session modal open/close around show and hide", async () => {
    const modal = new DioxusSendResourceModal();
    (modal as any).isLaunched = true;
    (modal as any).game = {
      config: () => ({
        maxTroops: () => BigInt(120),
      }),
    };

    const myPlayer = makePlayer({
      name: "Me",
      troops: 80,
      gold: 300,
      alive: true,
    });
    const target = makePlayer({
      name: "Target",
      troops: 20,
      gold: 50,
      alive: true,
    });

    await modal.show("troops", myPlayer, target, "Donate");
    expect(sessionRuntimeMocks.ensureUiSessionRuntimeStarted).toHaveBeenCalled();
    expect(sessionRuntimeMocks.reportUiModalState).toHaveBeenCalledWith(
      "send-resource",
      true,
    );
    expect(runtimeBridgeMocks.dispatchUiAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui.ingame.send-resource-modal.show",
      }),
    );

    await modal.hide();
    expect(sessionRuntimeMocks.reportUiModalState).toHaveBeenCalledWith(
      "send-resource",
      false,
    );
    expect(runtimeBridgeMocks.dispatchUiAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui.ingame.send-resource-modal.hide",
      }),
    );
  });

  test("closes when runtime emits modal-close event", async () => {
    const modal = new DioxusSendResourceModal();
    (modal as any).isLaunched = true;
    (modal as any).isVisible = true;

    (modal as any).handleSessionModalClose({
      detail: { modal: "send-resource", reason: "escape" },
    } as CustomEvent);
    await Promise.resolve();

    expect(sessionRuntimeMocks.reportUiModalState).toHaveBeenCalledWith(
      "send-resource",
      false,
    );
    expect(runtimeBridgeMocks.dispatchUiAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui.ingame.send-resource-modal.hide",
      }),
    );
  });
});
