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
  const allPops = () => [...panel.querySelectorAll("[data-gold-pop]")];
  // Each pop's text and rank, oldest first.
  const pops = () =>
    allPops().map((p) => [p.textContent?.trim(), p.getAttribute("data-rank")]);
  const popOf = (text: string) =>
    allPops().find((p) => p.textContent?.trim() === text) ?? null;
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

  it("adds up gains in the same tick in one pop", async () => {
    await tick({
      [GameUpdateType.BonusEvent]: [
        { player: "me", gold: 100, troops: 0, tile: 0 },
        { player: "me", gold: 200, troops: 0, tile: 0 },
      ],
    });

    expect(pops()).toEqual([["+300", "0"]]);
  });

  it("adds up a gain 89 ms after the last one, and pops one 90 ms after it", async () => {
    await tick(bonus(100));
    await vi.advanceTimersByTimeAsync(89);
    await tick(bonus(200));
    expect(pops()).toEqual([["+300", "0"]]);

    await vi.advanceTimersByTimeAsync(90);
    await tick(bonus(50));
    expect(pops()).toEqual([
      ["+300", "1"],
      ["+50", "0"],
    ]);
  });

  it("bumps the amount of the newest pop on a merge, without a new entrance", async () => {
    await tick(bonus(100));
    const first = pop()!;
    expect(first.querySelector("[data-bump]")).toBeNull();

    await vi.advanceTimersByTimeAsync(50);
    await tick(bonus(200));
    expect(pop()).toBe(first);
    const bumped = first.querySelector("[data-bump]");
    expect(bumped).not.toBeNull();

    // Each merge plays the bump again.
    await vi.advanceTimersByTimeAsync(50);
    await tick(bonus(1));
    expect(pops()).toEqual([["+301", "0"]]);
    expect(first.querySelector("[data-bump]")).not.toBe(bumped);

    // The bump ending does not end the pop.
    await endAnimation(first.querySelector("[data-bump]"));
    expect(pop()).toBe(first);
  });

  it("keeps three pops; a fourth pushes the oldest out, which fades until its animation ends", async () => {
    for (const gold of [1, 2, 3, 4]) {
      await tick(bonus(gold));
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(pops()).toEqual([
      ["+1", "3"],
      ["+2", "2"],
      ["+3", "1"],
      ["+4", "0"],
    ]);

    await endAnimation(popOf("+1"));
    expect(pops()).toEqual([
      ["+2", "2"],
      ["+3", "1"],
      ["+4", "0"],
    ]);

    // One still fading goes at once when the next is pushed out.
    await tick(bonus(5));
    await vi.advanceTimersByTimeAsync(200);
    await tick(bonus(6));
    expect(pops()).toEqual([
      ["+3", "3"],
      ["+4", "2"],
      ["+5", "1"],
      ["+6", "0"],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("takes each pop away when its own animation ends", async () => {
    for (const gold of [1, 2, 3]) {
      await tick(bonus(gold));
      await vi.advanceTimersByTimeAsync(200);
    }

    await endAnimation(popOf("+2"));

    expect(pops()).toEqual([
      ["+1", "1"],
      ["+3", "0"],
    ]);
  });

  it("drops the pops when my player dies", async () => {
    await tick(bonus(25_000));
    await vi.advanceTimersByTimeAsync(200);
    await tick(bonus(300));

    alive = false;
    await tick();

    expect(pop()).toBeNull();
  });

  it("shows no old pop when the panel is removed and put back", async () => {
    await tick(bonus(25_000));
    await vi.advanceTimersByTimeAsync(200);
    await tick(bonus(300));

    panel.remove();
    document.body.appendChild(panel);
    await tick();

    expect(pop()).toBeNull();
  });
});
