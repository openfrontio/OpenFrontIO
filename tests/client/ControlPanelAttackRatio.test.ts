import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { UserSettings } from "../../src/core/game/UserSettings";

// ControlPanel caches the attack ratio for the lifetime of the game. The
// settings modal is reachable mid-match now, so the cached value has to follow
// the stored one.
describe("control-panel attack ratio", () => {
  let panel: ControlPanel;
  let uiState: UIState;

  beforeEach(async () => {
    document.body.innerHTML = "";
    localStorage.clear();
    // UserSettings' cache is static and survives localStorage.clear().
    new UserSettings().setAttackRatio(0.2);
    if (!customElements.get("control-panel")) {
      customElements.define("control-panel", ControlPanel);
    }

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

  it("follows the attack ratio when the settings modal changes it", () => {
    expect(uiState.attackRatio).toBeCloseTo(0.2);

    new UserSettings().setAttackRatio(0.55);

    expect(uiState.attackRatio).toBeCloseTo(0.55);
  });

  it("stops listening once the panel is gone", () => {
    panel.remove();

    new UserSettings().setAttackRatio(0.75);

    expect(uiState.attackRatio).toBeCloseTo(0.2);
  });
});
