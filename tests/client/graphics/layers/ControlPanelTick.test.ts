import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Side-effect import: the @customElement decorator registers <control-panel>
// when the module is evaluated, and a type-only reference would not evaluate it.
import "../../../../src/client/hud/layers/ControlPanel";
import type { ControlPanel } from "../../../../src/client/hud/layers/ControlPanel";
import { AttackRatioEvent } from "../../../../src/client/InputHandler";
import type { UIState } from "../../../../src/client/UIState";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { UserSettings } from "../../../../src/core/game/UserSettings";

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
});
