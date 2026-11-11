import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EventBus } from "@openfront/shared/EventBus";
import type { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
// Side-effect import: registers <control-panel>.
import "../../src/client/hud/layers/ControlPanel";
import type { UIState } from "../../src/client/UIState";
import { UserSettings } from "../../src/client/UserSettings";
import type { GameView } from "../../src/client/view";

describe("control-panel troop rate trend", () => {
  let panel: ControlPanel;
  // The troops added per tick, as the game reports it on the next tick.
  let ratePerTick: number;

  // One tick of the layer per rate, in order.
  const ticks = async (...rates: number[]) => {
    for (const rate of rates) {
      ratePerTick = rate;
      panel.tick();
    }
    await panel.updateComplete;
  };
  const trend = () =>
    panel.querySelector("[data-troop-rate]")?.getAttribute("data-rate-trend");

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    // A veteran: tick() skips the hint code, which needs a real map.
    localStorage.setItem("gamesPlayed", "20");
    new UserSettings().setAttackRatio(0.2);

    ratePerTick = 0;
    const player = {
      isAlive: () => true,
      troops: () => 500_000,
      gold: () => 0n,
      outgoingAttacks: () => [],
    };
    panel = document.createElement("control-panel") as ControlPanel;
    panel.uiState = { attackRatio: 0 } as UIState;
    panel.eventBus = new EventBus();
    panel.game = {
      inSpawnPhase: () => false,
      ticks: () => 0,
      updatesSinceLastTick: () => null,
      myPlayer: () => player,
      config: () => ({
        maxTroops: () => 1_000_000,
        troopIncreaseRate: () => ratePerTick,
      }),
    } as unknown as GameView;
    document.body.appendChild(panel);
    panel.init();
  });

  afterEach(() => {
    panel.remove();
  });

  it("shows a rising rate on the first tick, whatever the rate", async () => {
    await ticks(40);
    expect(trend()).toBe("up");
  });

  it("does not count the first tick as a turn", async () => {
    // Two falls after the first tick: one short of a turn.
    await ticks(100, 90, 80);
    expect(trend()).toBe("up");
  });

  it("keeps the colour through one or two falling ticks", async () => {
    await ticks(100, 90);
    expect(trend()).toBe("up");
    await ticks(80);
    expect(trend()).toBe("up");
  });

  it("turns down after three falling ticks in a row", async () => {
    await ticks(100, 90, 80, 70);
    expect(trend()).toBe("down");
  });

  it("starts the count again after a tick that goes the shown way", async () => {
    await ticks(100, 90, 80, 85, 75, 65);
    expect(trend()).toBe("up");
    await ticks(55);
    expect(trend()).toBe("down");
  });

  it("never turns while the rate goes up and down every tick", async () => {
    await ticks(100, 90, 100, 90, 100, 90, 100, 90, 100);
    expect(trend()).toBe("up");
  });

  it("turns back up after three rising ticks", async () => {
    await ticks(100, 90, 80, 70);
    expect(trend()).toBe("down");
    await ticks(75, 80);
    expect(trend()).toBe("down");
    await ticks(85);
    expect(trend()).toBe("up");
  });

  it("counts a rate that holds still as rising", async () => {
    // As before: at the troop cap the rate stays at 0 and the chip is green.
    await ticks(100, 100, 100, 100);
    expect(trend()).toBe("up");
    await ticks(90, 80, 70);
    expect(trend()).toBe("down");
    await ticks(70, 70);
    expect(trend()).toBe("down");
    await ticks(70);
    expect(trend()).toBe("up");
  });

  it("reads a negative rate, troops above a shrunken cap, as falling", async () => {
    // The game then takes the excess back: the troops are going down, so
    // the chip turns orange like any fall.
    await ticks(100, -50, -80, -120);
    expect(trend()).toBe("down");
    expect(panel.querySelector("[data-troop-rate]")?.textContent?.trim()).toBe(
      "−120/s",
    );
  });
});
