import { describe, expect, it } from "vitest";
import { endScreenStats } from "../../src/client/hud/EndScreenStats";
import type { GameView, PlayerView } from "../../src/client/view";

function player(
  tiles: number,
  opts: { spawned?: boolean; team?: string } = {},
): PlayerView {
  return {
    numTilesOwned: () => tiles,
    // PlayerView.isAlive() means "owns at least one tile".
    isAlive: () => tiles > 0,
    hasSpawned: () => opts.spawned ?? true,
    team: () => opts.team ?? null,
  } as unknown as PlayerView;
}

function game(opts: {
  me: PlayerView | null;
  players: PlayerView[];
  land?: number;
  fallout?: number;
  seconds?: number;
  spawnPhase?: boolean;
}): GameView {
  return {
    inSpawnPhase: () => opts.spawnPhase ?? false,
    elapsedGameSeconds: () => opts.seconds ?? 754.3,
    myPlayer: () => opts.me,
    playerViews: () => opts.players,
    numLandTiles: () => opts.land ?? 1000,
    numTilesWithFallout: () => opts.fallout ?? 0,
  } as unknown as GameView;
}

describe("endScreenStats", () => {
  it("counts whole seconds of play", () => {
    const me = player(10);
    expect(endScreenStats(game({ me, players: [me] }))?.seconds).toBe(754);
  });

  it("gives my tiles over the land fallout has not taken", () => {
    const me = player(150);
    const stats = endScreenStats(
      game({ me, players: [me], land: 1000, fallout: 250 }),
    );
    expect(stats?.landShare).toBe(0.2);
  });

  it("gives a land share of 0 when no land is left to own", () => {
    const me = player(150);
    const stats = endScreenStats(
      game({ me, players: [me], land: 1000, fallout: 1000 }),
    );
    expect(stats?.landShare).toBe(0);
  });

  it("ranks me behind the players with strictly more tiles", () => {
    const me = player(100);
    const players = [player(300), me, player(200), player(100), player(50)];
    expect(endScreenStats(game({ me, players }))?.rank).toBe(3);
  });

  it("gives players tied on tiles the better rank, whatever the order", () => {
    const me = player(200);
    const players = [player(300), me, player(200), player(100)];
    const rival = players[2];
    expect(endScreenStats(game({ me, players }))?.rank).toBe(2);
    expect(
      endScreenStats(game({ me, players: [...players].reverse() }))?.rank,
    ).toBe(2);
    // The other leader on 200 tiles is #2 as well, and the next one #4.
    expect(endScreenStats(game({ me: rival, players }))?.rank).toBe(2);
    expect(endScreenStats(game({ me: players[3], players }))?.rank).toBe(4);
  });

  it("ranks a dead player just behind everyone still alive, with no land share", () => {
    const me = player(0);
    const players = [player(300), player(0), me, player(20)];
    const stats = endScreenStats(game({ me, players }));
    expect(stats?.rank).toBe(3);
    expect(stats?.landShare).toBeNull();
  });

  it("gives a spectator or replay viewer the time only", () => {
    const players = [player(300), player(20)];
    expect(endScreenStats(game({ me: null, players }))).toEqual({
      seconds: 754,
      landShare: null,
      rank: null,
      players: 2,
      team: false,
    });
  });

  it("gives a player who never spawned the time only", () => {
    const me = player(0, { spawned: false });
    const stats = endScreenStats(game({ me, players: [player(300), me] }));
    expect(stats?.seconds).toBe(754);
    expect(stats?.rank).toBeNull();
    expect(stats?.landShare).toBeNull();
  });

  it("counts everyone who spawned, dead ones included, but no one who never did", () => {
    const me = player(100);
    const players = [me, player(300), player(0), player(0, { spawned: false })];
    expect(endScreenStats(game({ me, players }))?.players).toBe(3);
  });

  it("in a team game, gives my team's land and my rank among my teammates", () => {
    const me = player(100, { team: "Blue" });
    const players = [
      player(400, { team: "Red" }),
      player(300, { team: "Blue" }),
      me,
      player(50, { team: "Blue" }),
      player(0, { team: "Blue", spawned: false }),
    ];
    const stats = endScreenStats(game({ me, players, land: 1000 }));
    expect(stats).toMatchObject({
      landShare: 0.45, // 300 + 100 + 50 of 1000; Red's 400 is not ours
      rank: 2, // behind the teammate on 300, not the Red player on 400
      players: 3, // the teammates who spawned
      team: true,
    });
  });

  it("in a team game, keeps my team's land when I am dead and ranks me behind my living teammates", () => {
    const me = player(0, { team: "Blue" });
    const players = [
      player(200, { team: "Blue" }),
      me,
      player(0, { team: "Blue" }),
      player(500, { team: "Red" }),
    ];
    const stats = endScreenStats(game({ me, players, land: 1000 }));
    expect(stats).toMatchObject({ landShare: 0.2, rank: 2, players: 3 });
  });

  it("has no stats during the spawn phase", () => {
    const me = player(10);
    expect(
      endScreenStats(game({ me, players: [me], spawnPhase: true })),
    ).toBeNull();
  });
});
