/**
 * @jest-environment jsdom
 */
// Stub lit to avoid ESM import issues in unit tests.
jest.mock("lit", () => ({
  LitElement: class {},
  html: () => null,
}));
jest.mock("lit/decorators.js", () => ({
  customElement: () => () => {},
  property: () => () => {},
  state: () => () => {},
}));
jest.mock("../../../src/client/Transport", () => ({
  SendVassalSupportIntentEvent: class {
    ratio: number;
    constructor(ratio: number) {
      this.ratio = ratio;
    }
  },
}));
jest.mock("../../../src/client/graphics/UIState", () => {
  return {
    UIState: class {
      attackRatio = 0;
      vassalSupportRatio = 0;
    },
  };
});

import { ControlPanel } from "../../../src/client/graphics/layers/ControlPanel";
import { UIState } from "../../../src/client/graphics/UIState";
import { SendVassalSupportIntentEvent } from "../../../src/client/Transport";
import { AttackRatioEvent } from "../../../src/client/InputHandler";

describe("ControlPanel vassal support init", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("emits initial vassal support once when player exists and vassals enabled", () => {
    localStorage.setItem("settings.vassalSupportRatio", "0.55");

    const mockEventBus = {
      on: jest.fn(),
      emit: jest.fn(),
    };

    const mockPlayer = {
      isAlive: () => true,
      gold: () => 0,
      troops: () => 0,
    } as any;

    const mockGame = {
      inSpawnPhase: () => false,
      myPlayer: () => mockPlayer,
      ticks: () => 1,
      config: () => ({
        vassalsEnabled: () => true,
        maxTroops: () => 0,
        troopIncreaseRate: () => 0,
        theme: () => ({
          territoryColor: () => ({
            lighten: () => ({ alpha: () => ({ toRgbString: () => "#fff" }) }),
          }),
        }),
        isUnitDisabled: () => false,
      }),
    } as any;

    const uiState = { attackRatio: 0, vassalSupportRatio: 0 } as any;
    const panel = new ControlPanel();
    (panel as any).requestUpdate = jest.fn();
    panel.game = mockGame;
    panel.clientID = "client";
    panel.eventBus = mockEventBus as any;
    panel.uiState = uiState;

    panel.init();
    panel.tick();

    // Should have emitted once with the persisted ratio
    expect(mockEventBus.emit).toHaveBeenCalledTimes(1);
    const evt = mockEventBus.emit.mock.calls[0][0];
    expect(evt).toBeInstanceOf(SendVassalSupportIntentEvent);
    expect((evt as SendVassalSupportIntentEvent).ratio).toBe(0.55);

    // Tick again should not emit again
    panel.tick();
    expect(mockEventBus.emit).toHaveBeenCalledTimes(1);
  });
});
