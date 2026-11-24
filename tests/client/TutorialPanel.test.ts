import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import "../../src/client/hud/layers/TutorialPanel";
import type { TutorialPanel } from "../../src/client/hud/layers/TutorialPanel";
import type { UIState } from "../../src/client/UIState";
import type { UserSettings } from "../../src/client/UserSettings";
import type { GameView } from "../../src/client/view";

// Every unit and alliances are off and there are no bots or nations, so the
// tutorial is its five opening steps: spawn, attack_wilderness, troops,
// troop_rate, attack_ratio.
async function mount() {
  const me = { spawned: false };
  const player = {
    hasSpawned: () => me.spawned,
    isAlive: () => true,
    outgoingAttacks: () => [],
    units: () => [],
    alliances: () => [],
    gold: () => 0n,
    buildables: async () => [],
    nameLocation: () => ({ x: 10, y: 10 }),
  };
  const setTutorialDismissed = vi.fn();
  const panel = document.createElement("tutorial-panel") as TutorialPanel;
  panel.game = {
    config: () => ({
      isReplay: () => false,
      gameConfig: () => ({}),
      isUnitDisabled: () => true,
      disableAlliances: () => true,
    }),
    myPlayer: () => player,
    resumedFromSave: () => false,
    inSpawnPhase: () => false,
    ticks: () => 0,
    playerViews: () => [],
    markedPlayers: () => null,
    setOwnSpawnRing: vi.fn(),
    setMarkedPlayers: vi.fn(),
  } as unknown as GameView;
  panel.eventBus = new EventBus();
  panel.uiState = { attackRatio: 0.2 } as UIState;
  panel.userSettings = {
    tutorialDismissed: () => false,
    setTutorialDismissed,
    parsedUserKeybinds: () => ({}),
  } as unknown as UserSettings;
  document.body.appendChild(panel);

  // The panel renders once per game tick.
  const tick = async () => {
    panel.tick();
    await panel.updateComplete;
  };
  const button = (label: string) =>
    [...panel.querySelectorAll("button")].find(
      (b) =>
        b.getAttribute("aria-label") === label ||
        b.textContent?.trim() === label,
    );
  const progress = () => panel.querySelector('[role="progressbar"]');

  await tick();
  return { panel, me, setTutorialDismissed, tick, button, progress };
}

describe("TutorialPanel card", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("counts the steps with the step_counter translation", async () => {
    const { panel, progress } = await mount();
    const counter = 'tutorial.step_counter:{"current":1,"total":5}';
    expect(panel.textContent).toContain(counter);
    // Phones hide the visible counter; the progress line still says it.
    expect(progress()?.getAttribute("aria-valuetext")).toBe(counter);
  });

  it("fills the progress line as steps complete", async () => {
    const { me, tick, progress } = await mount();
    expect(progress()?.getAttribute("aria-valuemax")).toBe("5");
    expect(progress()?.getAttribute("aria-valuenow")).toBe("0");

    me.spawned = true;
    await tick();
    expect(progress()?.getAttribute("aria-valuenow")).toBe("1");
  });

  it("marks an informational step done on Got it and drops its actions", async () => {
    const { panel, tick, button } = await mount();
    button("tutorial.skip")!.click();
    await tick();
    button("tutorial.skip")!.click();
    await tick();
    expect(panel.querySelector("[data-step-done]")).toBeNull();

    button("tutorial.got_it")!.click();
    await tick();
    expect(panel.querySelector("[data-step-done]")).not.toBeNull();
    expect(button("tutorial.got_it")).toBeUndefined();
    expect(button("tutorial.skip")).toBeUndefined();
  });

  // Phones and wider screens place the actions differently, with CSS only:
  // a second, hidden copy of the buttons would be read and tabbed to twice.
  it("renders one Skip and at most one primary action per step", async () => {
    const { panel, tick, button } = await mount();
    const count = (label: string) =>
      [...panel.querySelectorAll("button")].filter(
        (b) => b.textContent?.trim() === label,
      ).length;
    const actions = () => ({
      skip: count("tutorial.skip"),
      goTo: count("tutorial.go_to"),
      gotIt: count("tutorial.got_it"),
    });

    // spawn: nothing to point at or acknowledge.
    expect(actions()).toEqual({ skip: 1, goTo: 0, gotIt: 0 });
    button("tutorial.skip")!.click();
    await tick();
    // attack_wilderness: points at our own land.
    expect(actions()).toEqual({ skip: 1, goTo: 1, gotIt: 0 });
    button("tutorial.skip")!.click();
    await tick();
    // troops: informational.
    expect(actions()).toEqual({ skip: 1, goTo: 0, gotIt: 1 });
  });

  it("moves to the next step on Skip", async () => {
    const { panel, tick, button } = await mount();
    button("tutorial.skip")!.click();
    await tick();
    expect(panel.textContent).toContain(
      'tutorial.step_counter:{"current":2,"total":5}',
    );
  });

  it("hides the card for this game", async () => {
    const { panel, setTutorialDismissed, tick, button, progress } =
      await mount();
    const close = button("tutorial.close")!;
    expect(close.getAttribute("aria-expanded")).toBe("false");
    close.click();
    await panel.updateComplete;
    expect(close.getAttribute("aria-expanded")).toBe("true");
    expect(button("tutorial.skip")).toBeUndefined();

    button("tutorial.hide_for_game")!.click();
    await tick();
    expect(progress()).toBeNull();
    expect(setTutorialDismissed).not.toHaveBeenCalled();
  });

  it("can be dismissed for good", async () => {
    const { panel, setTutorialDismissed, tick, button, progress } =
      await mount();
    button("tutorial.close")!.click();
    await panel.updateComplete;
    button("tutorial.never_show")!.click();
    await tick();
    expect(progress()).toBeNull();
    expect(setTutorialDismissed).toHaveBeenCalledWith(true);
  });

  it("shows the closing message and a full line once finished", async () => {
    const { panel, tick, button, progress } = await mount();
    for (let i = 0; i < 5; i++) {
      button("tutorial.skip")!.click();
      await tick();
    }
    expect(panel.textContent).toContain("tutorial.complete");
    expect(panel.textContent).not.toContain("tutorial.step_counter");
    expect(progress()?.getAttribute("aria-valuenow")).toBe("5");
    expect(button("tutorial.skip")).toBeUndefined();
  });
});
