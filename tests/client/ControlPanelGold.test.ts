import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
// Side-effect import: the @customElement decorator registers <control-panel>
// when the module is evaluated, and a type-only reference would not evaluate it.
import type { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
import "../../src/client/hud/layers/ControlPanel";
import type { UIState } from "../../src/client/UIState";
import { UserSettings } from "../../src/client/UserSettings";
import type { GameView } from "../../src/client/view";

describe("control-panel gold gains", () => {
  let panel: ControlPanel;
  let alive: boolean;
  // The updates the next tick reads.
  let updates: Partial<Record<GameUpdateType, unknown[]>>;

  const tick = async (next: typeof updates = {}) => {
    updates = next;
    panel.tick();
    await panel.updateComplete;
  };
  const pop = () => panel.querySelector("[data-gold-pop]");
  // jsdom runs no CSS animation: end the pop's by hand.
  const endAnimation = async (el: Element | null) => {
    el?.dispatchEvent(new Event("animationend", { bubbles: true }));
    await panel.updateComplete;
  };
  const bonus = (gold: number, player = "me") => ({
    [GameUpdateType.BonusEvent]: [{ player, gold, troops: 0, tile: 0 }],
  });

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    localStorage.clear();
    // A veteran: tick() skips the hint code, which needs a real map.
    localStorage.setItem("gamesPlayed", "20");
    new UserSettings().setAttackRatio(0.2);

    alive = true;
    updates = {};
    const player = {
      isAlive: () => alive,
      id: () => "me",
      troops: () => 500_000,
      gold: () => 1000n,
      outgoingAttacks: () => [],
    };
    panel = document.createElement("control-panel") as ControlPanel;
    panel.uiState = { attackRatio: 0 } as UIState;
    panel.eventBus = new EventBus();
    panel.game = {
      inSpawnPhase: () => false,
      ticks: () => 0,
      updatesSinceLastTick: () => updates,
      myPlayer: () => player,
      config: () => ({
        maxTroops: () => 1_000_000,
        troopIncreaseRate: () => 100,
      }),
    } as unknown as GameView;
    document.body.appendChild(panel);
    panel.init();
  });

  afterEach(() => {
    panel.remove();
    vi.useRealTimers();
  });

  it.each([
    ["a bonus", bonus(25_000)],
    [
      "a conquest",
      {
        [GameUpdateType.ConquestEvent]: [
          { conquerorId: "me", conqueredId: "them", gold: 25_000n },
        ],
      },
    ],
    [
      "a gold donation",
      {
        [GameUpdateType.DonateEvent]: [
          {
            donationType: "gold",
            senderId: "them",
            recipientId: "me",
            amount: 25_000n,
          },
        ],
      },
    ],
  ])("shows the amount of %s to me", async (_, gain) => {
    await tick(gain);

    expect(pop()?.textContent?.trim()).toBe("+25.0K");
    // The chip's own number already changes for a screen reader.
    expect(pop()?.getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    ["another player's bonus", bonus(25_000, "them")],
    ["a zero bonus", bonus(0)],
    [
      "a troop donation",
      {
        [GameUpdateType.DonateEvent]: [
          {
            donationType: "troops",
            senderId: "them",
            recipientId: "me",
            amount: 25_000n,
          },
        ],
      },
    ],
  ])("shows nothing for %s", async (_, gain) => {
    await tick(gain);

    expect(pop()).toBeNull();
  });

  it("keeps the pop until its animation ends, with no timer", async () => {
    await tick(bonus(25_000));
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(5000);
    expect(pop()).not.toBeNull();
    await endAnimation(pop());
    expect(pop()).toBeNull();
  });

  it("replaces the pop with a newer gain, which keeps its whole animation", async () => {
    await tick(bonus(25_000));
    const first = pop();
    await tick(bonus(300));

    expect(panel.querySelectorAll("[data-gold-pop]")).toHaveLength(1);
    expect(pop()?.textContent?.trim()).toBe("+300");
    // The replaced pop's animation stops as it leaves the page.
    first?.dispatchEvent(new Event("animationcancel"));
    await panel.updateComplete;
    expect(pop()).not.toBeNull();
    await endAnimation(pop());
    expect(pop()).toBeNull();
  });

  it("drops the pop when my player dies", async () => {
    await tick(bonus(25_000));

    alive = false;
    await tick();

    expect(pop()).toBeNull();
  });

  it("shows no old pop when the panel is removed and put back", async () => {
    await tick(bonus(25_000));

    panel.remove();
    document.body.appendChild(panel);
    await tick();

    expect(pop()).toBeNull();
  });
});
