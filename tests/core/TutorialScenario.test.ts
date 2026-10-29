import {
  Difficulty,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { TribeExecution } from "@openfront/engine/execution/TribeExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { MockInstance } from "vitest";
import { setup } from "../util/Setup";

// Full-height stripes, left to right. A null id leaves the stripe free land.
async function setupStripes(
  stripes: [string | null, PlayerType][],
  tutorial = true,
): Promise<Game> {
  const game = await setup(
    "big_plains",
    { tutorial, difficulty: Difficulty.Easy },
    stripes
      .filter(
        ([id], i) => id !== null && stripes.findIndex(([o]) => o === id) === i,
      )
      .map(([id, type]) => new PlayerInfo(id!, type, null, id!)),
  );
  const owners = stripes.map(([id]) => (id === null ? null : game.player(id)));
  game.map().forEachTile((tile) => {
    const owner =
      owners[Math.floor((game.x(tile) * owners.length) / game.width())];
    if (owner !== null && game.map().isLand(tile)) owner.conquer(tile);
  });
  return game;
}

function attackTargets(
  spy: MockInstance<Game["addExecution"]>,
): (string | null)[] {
  return spy.mock.calls
    .map((c) => c[0])
    .filter((e): e is AttackExecution => e instanceof AttackExecution)
    .map((e) => e.targetID());
}

function playTribe(game: Game, tribe: Player, rounds: number) {
  tribe.setTroops(game.config().maxTroops(tribe));
  const exec = new TribeExecution(tribe);
  exec.init(game);
  // Every die roll comes up: outside the tutorial it would attack the traitor.
  vi.spyOn(exec["random"], "chance").mockReturnValue(true);
  for (let r = 0; r < rounds; r++) {
    exec.tick(exec["attackTick"] + r * exec["attackRate"]);
    tribe.setTroops(game.config().maxTroops(tribe));
  }
}

describe("Tutorial scenario", () => {
  test("the tribe only grows into free land", async () => {
    const game = await setupStripes([
      ["human", PlayerType.Human],
      ["tribe", PlayerType.Bot],
      [null, PlayerType.Bot],
    ]);
    game.player("human").markTraitor();
    const spy = vi.spyOn(game, "addExecution");

    playTribe(game, game.player("tribe"), 4);

    const targets = attackTargets(spy);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).not.toContain("human");
  });

  test("the tribe never attacks a player once free land is gone", async () => {
    const game = await setupStripes([
      ["human", PlayerType.Human],
      ["tribe", PlayerType.Bot],
      ["traitor", PlayerType.Human],
    ]);
    game.player("traitor").markTraitor();
    const spy = vi.spyOn(game, "addExecution");

    playTribe(game, game.player("tribe"), 4);

    const targets = attackTargets(spy);
    expect(targets).not.toContain("human");
    expect(targets).not.toContain("traitor");
  });

  test("the nation's and tribe's troop cap is 10% of normal", async () => {
    const stripes: [string, PlayerType][] = [
      ["human", PlayerType.Human],
      ["tribe", PlayerType.Bot],
      ["nation", PlayerType.Nation],
    ];
    const tutorial = await setupStripes(stripes);
    const normal = await setupStripes(stripes, false);
    const cap = (g: Game, id: string) => g.config().maxTroops(g.player(id));

    expect(cap(tutorial, "human")).toBeCloseTo(cap(normal, "human"));
    // Normal: a tribe gets a third, an Easy nation half.
    expect(cap(tutorial, "tribe")).toBeCloseTo(cap(normal, "tribe") * 0.3);
    expect(cap(tutorial, "nation")).toBeCloseTo(cap(normal, "nation") * 0.2);
  });

  test("the game is won once the human is the only player left", async () => {
    const game = await setupStripes([
      ["human", PlayerType.Human],
      ["human", PlayerType.Human],
      ["human", PlayerType.Human],
      ["human", PlayerType.Human],
      ["human", PlayerType.Human],
      ["human", PlayerType.Human],
      ["human", PlayerType.Human],
      ["human", PlayerType.Human],
      ["human", PlayerType.Human],
      ["tribe", PlayerType.Bot],
    ]);
    const human = game.player("human");
    const tribe = game.player("tribe");
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);

    // 90% of the land is no win while the tribe lives.
    winCheck.checkWinnerFFA();
    expect(game.getWinner()).toBeNull();
    expect(winCheck.isActive()).toBe(true);

    for (const tile of [...tribe.tiles()]) human.conquer(tile);
    winCheck.checkWinnerFFA();
    expect(game.getWinner()).toBe(human);
    expect(winCheck.isActive()).toBe(false);
  });
});
