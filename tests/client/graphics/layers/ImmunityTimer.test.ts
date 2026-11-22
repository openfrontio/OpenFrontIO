import { GameMode } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImmunityBarVisibleEvent } from "../../../../src/client/hud/layers/ImmunityTimer";
import type { ImmunityTimer } from "../../../../src/client/hud/layers/ImmunityTimer";
import type { GameView } from "../../../../src/client/view";

function makeGame({
  gameMode = GameMode.FFA,
  inSpawnPhase = false,
  hasExtendedSpawnImmunity = true,
  numSpawnPhaseTurns = 10,
  spawnImmunityDuration = 20,
  ticks = 20,
} = {}): GameView {
  return {
    config: () => ({
      gameConfig: () => ({ gameMode }),
      hasExtendedSpawnImmunity: () => hasExtendedSpawnImmunity,
      numSpawnPhaseTurns: () => numSpawnPhaseTurns,
      spawnImmunityDuration: () => spawnImmunityDuration,
    }),
    inSpawnPhase: () => inSpawnPhase,
    ticks: () => ticks,
  } as unknown as GameView;
}

describe("ImmunityTimer", () => {
  let timer: ImmunityTimer;
  let eventBus: EventBus;
  let visibility: ImmunityBarVisibleEvent[];

  beforeEach(() => {
    timer = document.createElement("immunity-timer") as ImmunityTimer;
    eventBus = new EventBus();
    visibility = [];
    eventBus.on(ImmunityBarVisibleEvent, (e) => visibility.push(e));
    timer.eventBus = eventBus;
    document.body.appendChild(timer);
  });

  afterEach(() => {
    timer.dispose();
    timer.remove();
  });

  it("emits ImmunityBarVisibleEvent(true) and renders progress bar during extended immunity", async () => {
    timer.game = makeGame({
      gameMode: GameMode.Team,
      inSpawnPhase: false,
      hasExtendedSpawnImmunity: true,
      numSpawnPhaseTurns: 10,
      spawnImmunityDuration: 20,
      ticks: 20,
    });

    timer.init();
    timer.tick();
    timer.tick();
    await timer.updateComplete;

    const bar = timer.querySelector<HTMLElement>('div[style*="width:"]');
    expect(bar).not.toBeNull();
    expect(bar?.style.width).toBe("50%");
    expect(timer.style.top).toBe("7px");
    expect(visibility.map((v) => v.visible)).toEqual([true]);
  });

  it("emits ImmunityBarVisibleEvent(false) on first tick when extended immunity is inactive", async () => {
    timer.game = makeGame({ hasExtendedSpawnImmunity: false });

    timer.init();
    timer.tick();
    timer.tick();
    await timer.updateComplete;

    expect(timer.querySelector('div[style*="width:"]')).toBeNull();
    expect(timer.style.top).toBe("0px");
    expect(visibility.map((v) => v.visible)).toEqual([false]);
  });

  it("emits ImmunityBarVisibleEvent(false) during spawn phase and after immunity expires", async () => {
    timer.game = makeGame({ inSpawnPhase: true, ticks: 5 });

    timer.init();
    timer.tick();
    await timer.updateComplete;
    expect(visibility.map((v) => v.visible)).toEqual([false]);
    expect(timer.querySelector('div[style*="width:"]')).toBeNull();

    timer.dispose();
    timer.game = makeGame({
      inSpawnPhase: false,
      numSpawnPhaseTurns: 10,
      spawnImmunityDuration: 20,
      ticks: 30,
    });

    timer.init();
    timer.tick();
    await timer.updateComplete;
    expect(visibility.map((v) => v.visible)).toEqual([false, false]);
    expect(timer.querySelector('div[style*="width:"]')).toBeNull();
  });

  it("re-emits initial ImmunityBarVisibleEvent across dispose and re-init cycles", async () => {
    timer.game = makeGame({ gameMode: GameMode.Team, ticks: 15 });

    timer.init();
    timer.tick();
    await timer.updateComplete;
    expect(visibility.map((v) => v.visible)).toEqual([true]);
    expect(timer.style.top).toBe("7px");
    expect(timer.querySelector('div[style*="width:"]')).not.toBeNull();

    timer.dispose();
    await timer.updateComplete;
    expect(timer.style.top).toBe("0px");
    expect(timer.querySelector('div[style*="width:"]')).toBeNull();
    expect(visibility.map((v) => v.visible)).toEqual([true]);

    timer.init();
    timer.tick();
    await timer.updateComplete;
    expect(visibility.map((v) => v.visible)).toEqual([true, true]);
    expect(timer.querySelector('div[style*="width:"]')).not.toBeNull();

    timer.dispose();
    timer.game = makeGame({ inSpawnPhase: true, ticks: 5 });
    timer.init();
    timer.tick();
    await timer.updateComplete;
    expect(visibility.map((v) => v.visible)).toEqual([true, true, false]);
    expect(timer.style.top).toBe("0px");
    expect(timer.querySelector('div[style*="width:"]')).toBeNull();
  });

  it("ignores ticks when inactive and respects generation-scoped disposer", async () => {
    timer.game = makeGame({ ticks: 20 });

    timer.tick();
    expect(visibility).toHaveLength(0);

    const disposeFirst = timer.init();
    timer.tick();
    expect(visibility.map((v) => v.visible)).toEqual([true]);

    timer.dispose();
    const disposeSecond = timer.init();
    disposeFirst();

    timer.tick();
    await timer.updateComplete;
    expect(visibility.map((v) => v.visible)).toEqual([true, true]);
    expect(timer.querySelector('div[style*="width:"]')).not.toBeNull();

    disposeSecond();
    timer.tick();
    await timer.updateComplete;
    expect(visibility.map((v) => v.visible)).toEqual([true, true]);
    expect(timer.querySelector('div[style*="width:"]')).toBeNull();
  });
});
