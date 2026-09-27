import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../../../src/client/hud/layers/SpawnTimer";
import type { SpawnTimer } from "../../../../src/client/hud/layers/SpawnTimer";
import { SpawnBarVisibleEvent } from "../../../../src/client/hud/layers/SpawnTimer";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { GameMode, GameType } from "../../../../src/core/game/Game";

function makePlayer(team: string | null, tiles: number) {
  return { team: () => team, numTilesOwned: () => tiles };
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
    timer.remove();
  });

  it("splits the bar by team tile ownership after the spawn phase", async () => {
    timer.game = {
      config: () => ({
        gameConfig: () => ({
          gameType: GameType.Public,
          gameMode: GameMode.Team,
        }),
      }),
      inSpawnPhase: () => false,
      players: () => [
        makePlayer("Red", 30),
        makePlayer("Blue", 10),
        makePlayer(null, 999), // teamless players are ignored
      ],
    } as unknown as GameView;

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

  it("renders nothing when no team owns tiles yet", async () => {
    timer.game = {
      config: () => ({
        gameConfig: () => ({
          gameType: GameType.Public,
          gameMode: GameMode.Team,
        }),
      }),
      inSpawnPhase: () => false,
      players: () => [makePlayer("Red", 0), makePlayer("Blue", 0)],
    } as unknown as GameView;

    timer.init();
    timer.tick();
    await timer.updateComplete;

    expect(timer.querySelectorAll('div[style*="--width"]')).toHaveLength(0);
    expect(visibility).toHaveLength(0);
  });
});
