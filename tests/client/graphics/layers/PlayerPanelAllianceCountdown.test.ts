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

import { PlayerPanel } from "../../../../src/client/hud/layers/PlayerPanel";
import { PlayerView } from "../../../../src/client/view";

describe("PlayerPanel - alliance countdown keeps updating after local player death", () => {
  let panel: PlayerPanel;

  beforeEach(() => {
    panel = new PlayerPanel();
    (panel as any).requestUpdate = vi.fn();
    (panel as any).isVisible = true;
    (panel as any).tile = { x: 0, y: 0 };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeGame(alive: () => boolean) {
    const myPlayer = {
      isAlive: alive,
      actions: () => Promise.resolve({ interaction: {} }),
    } as unknown as PlayerView;
    return {
      owner: () => null,
      myPlayer: () => myPlayer,
      ticks: () => 100,
    };
  }

  test("tick() repaints while the panel is visible and the local player is alive", async () => {
    (panel as any).g = makeGame(() => true);

    await (panel as any).tick();

    expect((panel as any).requestUpdate).toHaveBeenCalledTimes(1);
  });

  test("tick() keeps repainting after the local player dies so the alliance countdown continues updating", async () => {
    let alive = true;
    (panel as any).g = makeGame(() => alive);

    await (panel as any).tick();
    expect((panel as any).requestUpdate).toHaveBeenCalledTimes(1);

    // Local player dies while the panel stays open.
    alive = false;
    await (panel as any).tick();

    expect((panel as any).requestUpdate).toHaveBeenCalledTimes(2);
  });

  test("tick() does not repaint when the panel is hidden", async () => {
    (panel as any).g = makeGame(() => true);
    (panel as any).isVisible = false;

    await (panel as any).tick();

    expect((panel as any).requestUpdate).not.toHaveBeenCalled();
  });
});
