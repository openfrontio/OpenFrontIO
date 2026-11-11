import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Side-effect import: the @customElement decorator registers <control-panel>
// when the module is evaluated, and a type-only reference would not evaluate it.
import { EventBus } from "@openfront/shared/EventBus";
import type { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
import "../../src/client/hud/layers/ControlPanel";
import { OnboardingLowTroopsEvent } from "../../src/client/hud/Onboarding";
import {
  TutorialHighlight,
  TutorialHighlightEvent,
} from "../../src/client/hud/Tutorial";
import type { UIState } from "../../src/client/UIState";
import { UserSettings } from "../../src/client/UserSettings";
import type { GameView } from "../../src/client/view";

describe("control-panel troop bar", () => {
  let panel: ControlPanel;
  // What the fake game reports; a test changes it before a tick.
  let me: {
    troops: number;
    gold: bigint;
    attacking: number[];
    ratePerTick: number;
  };

  const tick = async () => {
    panel.tick();
    await panel.updateComplete;
  };
  const q = (selector: string) => panel.querySelector(selector);

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    // A veteran: tick() skips the hint code, which needs a real map.
    localStorage.setItem("gamesPlayed", "20");
    new UserSettings().setAttackRatio(0.2);

    me = { troops: 500_000, gold: 1000n, attacking: [], ratePerTick: 123 };
    const player = {
      isAlive: () => true,
      id: () => "me",
      troops: () => me.troops,
      gold: () => me.gold,
      outgoingAttacks: () => me.attacking.map((troops) => ({ troops })),
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
        troopIncreaseRate: () => me.ratePerTick,
      }),
    } as unknown as GameView;
    document.body.appendChild(panel);
    panel.init();
  });

  afterEach(() => {
    panel.remove();
  });

  it("shows my troops, the cap and the rate per second after a tick", async () => {
    await tick();

    expect(q("[data-troops]")?.textContent?.trim()).toBe("50.0K");
    expect(q("[data-max-troops]")?.textContent?.trim()).toBe("100K");
    // 123 a tick, ten ticks a second, shown in tenths like every troop count.
    expect(q("[data-troop-rate]")?.textContent?.trim()).toBe("+123/s");
  });

  it("shows a falling rate with a minus sign", async () => {
    // Troops above a shrunken cap drain away, so the rate goes below zero.
    me.ratePerTick = -120;
    await tick();

    expect(q("[data-troop-rate]")?.textContent?.trim()).toBe("−120/s");
  });

  it("marks the bar while troops are out attacking, and not otherwise", async () => {
    await tick();
    expect(q("[data-troop-bar]")?.hasAttribute("data-attacking")).toBe(false);

    me.attacking = [20_000, 5_000];
    await tick();
    expect(q("[data-troop-bar]")?.hasAttribute("data-attacking")).toBe(true);

    me.attacking = [];
    await tick();
    expect(q("[data-troop-bar]")?.hasAttribute("data-attacking")).toBe(false);
  });

  it("marks the bar while the tutorial's low-troops alert is up", async () => {
    await tick();
    expect(q("[data-troop-bar]")?.hasAttribute("data-alert")).toBe(false);

    panel.eventBus.emit(new OnboardingLowTroopsEvent(true));
    await panel.updateComplete;
    expect(q("[data-troop-bar]")?.hasAttribute("data-alert")).toBe(true);

    panel.eventBus.emit(new OnboardingLowTroopsEvent(false));
    await panel.updateComplete;
    expect(q("[data-troop-bar]")?.hasAttribute("data-alert")).toBe(false);
  });

  // The tutorial overlay points at the first `control-panel .tutorial-highlight`
  // it finds, so each target must be on one element, the right one.
  it.each<[TutorialHighlight, () => Element | null | undefined]>([
    ["troop_rate", () => q("[data-troop-rate]")],
    ["troops", () => q("[data-troop-bar]")],
    ["gold", () => q("[data-gold]")],
    ["attack_ratio", () => q('input[type="range"]')?.parentElement],
  ])(
    "puts the tutorial's %s highlight on one element",
    async (target, part) => {
      await tick();
      panel.eventBus.emit(new TutorialHighlightEvent(target));
      await panel.updateComplete;

      const highlighted = panel.querySelectorAll(".tutorial-highlight");
      expect(highlighted).toHaveLength(1);
      expect(highlighted[0]).toBe(part());
    },
  );

  it("reads a rate that is not falling as up and a falling one as down", async () => {
    await tick();
    me.ratePerTick = 123;
    await tick();
    expect(q("[data-troop-rate]")?.getAttribute("data-rate-trend")).toBe("up");

    me.ratePerTick = 100;
    await tick();
    expect(q("[data-troop-rate]")?.getAttribute("data-rate-trend")).toBe(
      "down",
    );
  });
});
