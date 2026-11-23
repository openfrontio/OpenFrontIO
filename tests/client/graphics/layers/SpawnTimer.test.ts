import { GameMode, GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpawnBarVisibleEvent } from "../../../../src/client/hud/layers/SpawnTimer";
import type { SpawnTimer } from "../../../../src/client/hud/layers/SpawnTimer";
import type { GameView } from "../../../../src/client/view";

function makePlayer(team: string | null, tiles: number) {
  return { team: () => team, numTilesOwned: () => tiles };
}

function makeTeamGame(
  players: ReturnType<typeof makePlayer>[],
  inSpawnPhase = false,
): GameView {
  return {
    config: () => ({
      gameConfig: () => ({
        gameType: GameType.Public,
        gameMode: GameMode.Team,
      }),
    }),
    inSpawnPhase: () => inSpawnPhase,
    players: () => players,
  } as unknown as GameView;
}

describe("SpawnTimer team ratios", () => {
  let timer: SpawnTimer;
  let eventBus: EventBus;
  let visibility: SpawnBarVisibleEvent[];

  beforeEach(() => {
    timer = document.createElement("spawn-timer") as SpawnTimer;
    eventBus = new EventBus();
    visibility = [];
    eventBus.on(SpawnBarVisibleEvent, (e) => visibility.push(e));
    timer.eventBus = eventBus;
    document.body.appendChild(timer);
  });

  afterEach(() => {
    timer.dispose();
    timer.remove();
  });

  it("splits the bar by team tile ownership after the spawn phase", async () => {
    timer.game = makeTeamGame([
      makePlayer("Red", 30),
      makePlayer("Blue", 10),
      makePlayer(null, 999), // teamless players are ignored
    ]);

    timer.init();
    timer.tick();
    await timer.updateComplete;

    const segments = timer.querySelectorAll<HTMLElement>(
      'div[style*="--width"]',
    );
    expect(segments).toHaveLength(2);
    expect(segments[0].style.getPropertyValue("--width")).toBe("75%");
    expect(segments[1].style.getPropertyValue("--width")).toBe("25%");
    expect(visibility.map((v) => v.visible)).toEqual([true]);
  });

  it("renders nothing and emits initial false when no team owns tiles yet", async () => {
    timer.game = makeTeamGame([makePlayer("Red", 0), makePlayer("Blue", 0)]);

    timer.init();
    timer.tick();
    timer.tick();
    await timer.updateComplete;

    expect(timer.querySelectorAll('div[style*="--width"]')).toHaveLength(0);
    expect(visibility.map((v) => v.visible)).toEqual([false]);
  });

  it("re-emits SpawnBarVisibleEvent(true) on first tick after dispose and re-init", async () => {
    timer.game = makeTeamGame([makePlayer("Red", 10), makePlayer("Blue", 10)]);

    timer.init();
    timer.tick();
    await timer.updateComplete;
    expect(visibility.map((v) => v.visible)).toEqual([true]);
    expect(timer.querySelectorAll('div[style*="--width"]')).toHaveLength(2);

    timer.dispose();
    await timer.updateComplete;
    expect(timer.querySelectorAll('div[style*="--width"]')).toHaveLength(0);
    expect(visibility.map((v) => v.visible)).toEqual([true]);

    timer.init();
    timer.tick();
    timer.tick();
    await timer.updateComplete;
    expect(visibility.map((v) => v.visible)).toEqual([true, true]);
    expect(timer.querySelectorAll('div[style*="--width"]')).toHaveLength(2);
  });

  it("emits SpawnBarVisibleEvent(false) on first tick in Singleplayer spawn phase", async () => {
    timer.game = makeTeamGame([makePlayer("Red", 10), makePlayer("Blue", 10)]);
    timer.init();
    timer.tick();
    await timer.updateComplete;
    expect(visibility.map((v) => v.visible)).toEqual([true]);

    timer.dispose();
    timer.game = {
      config: () => ({
        gameConfig: () => ({
          gameType: GameType.Singleplayer,
          gameMode: GameMode.FFA,
        }),
      }),
      inSpawnPhase: () => true,
    } as unknown as GameView;

    timer.init();
    timer.tick();
    timer.tick();
    await timer.updateComplete;

    expect(timer.querySelectorAll('div[style*="--width"]')).toHaveLength(0);
    expect(visibility.map((v) => v.visible)).toEqual([true, false]);
  });

  it("ignores ticks when inactive and respects generation-scoped disposer", async () => {
    timer.game = makeTeamGame([makePlayer("Red", 10), makePlayer("Blue", 10)]);

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
    expect(timer.querySelectorAll('div[style*="--width"]')).toHaveLength(2);

    disposeSecond();
    timer.tick();
    await timer.updateComplete;
    expect(visibility.map((v) => v.visible)).toEqual([true, true]);
    expect(timer.querySelectorAll('div[style*="--width"]')).toHaveLength(0);
  });
});
