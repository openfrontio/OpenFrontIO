import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Side-effect import: the @customElement decorator registers <control-panel>
// when the module is evaluated, and a type-only reference would not evaluate it.
import { EventBus } from "@openfront/shared/EventBus";
import "../../../../src/client/hud/layers/ControlPanel";
import type { ControlPanel } from "../../../../src/client/hud/layers/ControlPanel";
import { OnboardingLowTroopsEvent } from "../../../../src/client/hud/Onboarding";
import {
  type TutorialHighlight,
  TutorialHighlightEvent,
} from "../../../../src/client/hud/Tutorial";
import { AttackRatioEvent } from "../../../../src/client/InputHandler";
import type { UIState } from "../../../../src/client/UIState";
import { UserSettings } from "../../../../src/client/UserSettings";
import type { GameView } from "../../../../src/client/view";

type ControlPanelInternals = {
  _tutorialHighlight: TutorialHighlight | null;
  _lowTroopsAlert: boolean;
  _ratioPopupOpen: boolean;
};

describe("control-panel keybind attack ratio and tick visibility", () => {
  let panel: ControlPanel;
  let uiState: UIState;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    // UserSettings' cache is static and survives localStorage.clear().
    new UserSettings().setAttackRatio(0.2);

    panel = document.createElement("control-panel") as ControlPanel;
    uiState = { attackRatio: 0 } as UIState;
    panel.uiState = uiState;
    panel.eventBus = new EventBus();
    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => null,
    } as unknown as GameView;
    document.body.appendChild(panel);
    panel.init();
  });

  afterEach(() => {
    panel.remove();
  });

  it("stepping up from the 1% floor snaps to 10% instead of 11%", () => {
    // Big decrement clamps to the 1% floor.
    panel.eventBus.emit(new AttackRatioEvent(-100));
    expect(uiState.attackRatio).toBe(0.01);

    // +10 from 1% would land on 11%; it snaps to 10% for consistency.
    panel.eventBus.emit(new AttackRatioEvent(10));
    expect(uiState.attackRatio).toBe(0.1);
  });

  it("normal keybind steps are not snapped", () => {
    panel.eventBus.emit(new AttackRatioEvent(10));
    expect(uiState.attackRatio).toBeCloseTo(0.3);
  });

  it("tick() hides the panel when there is no local player", () => {
    panel.tick();
    expect((panel as any)._isVisible).toBe(false);
  });

  it("tick() hides the panel once the local player is dead", () => {
    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => false, troops: () => 0 }),
    } as unknown as GameView;
    panel.setVisibile(true);

    panel.tick();

    expect((panel as any)._isVisible).toBe(false);
  });

  it("dispose() unregisters all 3 eventBus listeners and resets tutorial/alert/popup state", () => {
    const internals = panel as unknown as ControlPanelInternals;
    const bus = panel.eventBus;

    bus.emit(new TutorialHighlightEvent("troops"));
    bus.emit(new OnboardingLowTroopsEvent(true));
    internals._ratioPopupOpen = true;

    expect(internals._tutorialHighlight).toBe("troops");
    expect(internals._lowTroopsAlert).toBe(true);
    expect(internals._ratioPopupOpen).toBe(true);

    // Swapping eventBus before dispose() should still unsubscribe the original bus.
    panel.eventBus = new EventBus();
    panel.dispose();

    expect(internals._tutorialHighlight).toBeNull();
    expect(internals._lowTroopsAlert).toBe(false);
    expect(internals._ratioPopupOpen).toBe(false);

    bus.emit(new TutorialHighlightEvent("gold"));
    bus.emit(new OnboardingLowTroopsEvent(true));
    bus.emit(new AttackRatioEvent(10));

    expect(internals._tutorialHighlight).toBeNull();
    expect(internals._lowTroopsAlert).toBe(false);
    expect(uiState.attackRatio).toBeCloseTo(0.2);
  });

  it("reusing the panel across init/dispose/init cycles does not accumulate AttackRatioEvent listeners", () => {
    const bus1 = panel.eventBus;
    panel.dispose();

    const bus2 = new EventBus();
    panel.eventBus = bus2;
    panel.init();

    // Re-invoking init() directly should also remain idempotent.
    panel.init();

    bus1.emit(new AttackRatioEvent(10));
    expect(uiState.attackRatio).toBeCloseTo(0.2);

    bus2.emit(new AttackRatioEvent(10));
    expect(uiState.attackRatio).toBeCloseTo(0.3);

    panel.dispose();
    const bus3 = new EventBus();
    panel.eventBus = bus3;
    panel.init();

    bus2.emit(new AttackRatioEvent(10));
    expect(uiState.attackRatio).toBeCloseTo(0.2);

    bus3.emit(new AttackRatioEvent(10));
    expect(uiState.attackRatio).toBeCloseTo(0.3);
  });

  it("calling a disposer from an older init() after a newer init() does not unsubscribe the newer game", () => {
    const internals = panel as unknown as ControlPanelInternals;
    const disposeFirst = panel.init();

    const bus2 = new EventBus();
    panel.eventBus = bus2;
    const disposeSecond = panel.init();

    // Stale disposer from the previous game must be a no-op.
    disposeFirst();

    bus2.emit(new TutorialHighlightEvent("city"));
    bus2.emit(new OnboardingLowTroopsEvent(true));
    bus2.emit(new AttackRatioEvent(10));

    expect(internals._tutorialHighlight).toBe("city");
    expect(internals._lowTroopsAlert).toBe(true);
    expect(uiState.attackRatio).toBeCloseTo(0.3);

    // Current disposer tears down the active listeners and resets state.
    disposeSecond();

    expect(internals._tutorialHighlight).toBeNull();
    expect(internals._lowTroopsAlert).toBe(false);

    bus2.emit(new AttackRatioEvent(10));
    expect(uiState.attackRatio).toBeCloseTo(0.3);
  });

  it("direct dispose() invalidates earlier init() disposers across re-init()", () => {
    const internals = panel as unknown as ControlPanelInternals;
    const disposeFirst = panel.init();

    panel.dispose();

    const bus2 = new EventBus();
    panel.eventBus = bus2;
    panel.init();

    disposeFirst();

    bus2.emit(new TutorialHighlightEvent("troops"));
    bus2.emit(new OnboardingLowTroopsEvent(true));
    bus2.emit(new AttackRatioEvent(10));

    expect(internals._tutorialHighlight).toBe("troops");
    expect(internals._lowTroopsAlert).toBe(true);
    expect(uiState.attackRatio).toBeCloseTo(0.3);
  });
});
