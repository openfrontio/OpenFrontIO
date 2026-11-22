import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NationAirBehavior } from "@openfront/engine/execution/nation/NationAirBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const MAP = "big_plains";

let game: Game;
let nation: Player;
let enemy: Player;
let ai: NationAirBehavior;

function conquerRect(
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) p.conquer(game.ref(x, y));
  }
}

async function start(difficulty = Difficulty.Hard, gold = 50_000_000n) {
  game = await setup(MAP, { instantBuild: true, difficulty }, [
    new PlayerInfo("nation", PlayerType.Human, null, "nation"),
    new PlayerInfo("enemy", PlayerType.Human, null, "enemy"),
  ]);
  nation = game.player("nation");
  enemy = game.player("enemy");
  conquerRect(nation, 0, 0, 100, 200);
  conquerRect(enemy, 100, 0, 200, 200);
  nation.addTroops(100_000);
  enemy.addTroops(100_000);
  nation.addGold(gold);
  ai = new NationAirBehavior(game, nation);
}

/** Runs the behavior and lets its construction land. */
function act(): boolean {
  const acted = ai.handleAir();
  executeTicks(game, 3);
  return acted;
}

function cities(n: number): void {
  for (let i = 0; i < n; i++) {
    nation.buildUnit(UnitType.City, game.ref(15 + i * 18, 100), {});
  }
}

describe("NationAirBehavior", () => {
  test("builds an airbase only once its economy has three cities", async () => {
    await start();
    cities(2);
    expect(act()).toBe(false);
    expect(nation.units(UnitType.Airbase)).toHaveLength(0);
    cities(1);
    expect(act()).toBe(true);
    expect(nation.units(UnitType.Airbase)).toHaveLength(1);
    // One is enough while nothing threatens it.
    expect(act()).toBe(false);
  });

  test("spends only surplus gold", async () => {
    await start(Difficulty.Hard, 0n);
    cities(3);
    const airbaseCost = game.unitInfo(UnitType.Airbase).cost(game, nation);
    nation.addGold(airbaseCost); // 1x the cost: not enough surplus
    expect(act()).toBe(false);
    nation.addGold(airbaseCost); // 2x
    expect(act()).toBe(true);
  });

  test("keeps air assets within a budget proportional to its cities", async () => {
    await start();
    // Three level-1 cities: a 600k budget. The airbase (250k) and a radar
    // (300k) fit; a fighter (300k) more does not.
    cities(3);
    act(); // airbase
    const raid = game.ref(150, 150);
    enemy.buildUnit(UnitType.Bomber, raid, { patrolTile: raid });
    expect(act()).toBe(true);
    expect(nation.units(UnitType.RadarStation)).toHaveLength(1);
    expect(act()).toBe(false);
    expect(nation.units(UnitType.Fighter)).toHaveLength(0);
    // A bigger economy affords more.
    nation.units(UnitType.City)[0].increaseLevel();
    nation.units(UnitType.City)[0].increaseLevel();
    expect(act()).toBe(true);
    expect(nation.units(UnitType.Fighter)).toHaveLength(1);
  });

  test("answers hostile aircraft with AA guns, radar and fighters", async () => {
    await start();
    cities(5);
    act(); // airbase
    const raid = game.ref(45, 100);
    enemy.buildUnit(UnitType.Bomber, raid, { patrolTile: raid });

    expect(act()).toBe(true);
    expect(nation.units(UnitType.AAGun)).toHaveLength(1);
    expect(act()).toBe(true);
    expect(nation.units(UnitType.RadarStation)).toHaveLength(1);
    expect(act()).toBe(true);
    expect(nation.units(UnitType.Fighter).length).toBeGreaterThan(0);
  });

  test("sends attack helicopters after enemy boats near its coast", async () => {
    await start();
    cities(3);
    act(); // airbase
    const boat = enemy.buildUnit(UnitType.TransportShip, game.ref(70, 100), {
      troops: 100,
    });
    expect(act()).toBe(true);
    const helis = nation.units(UnitType.AttackHelicopter);
    expect(helis).toHaveLength(1);
    expect(helis[0].warshipState().patrolTile).toBe(boat.tile());
  });

  test("bombs the least-defended structure of the side it attacks", async () => {
    await start();
    cities(4);
    act(); // airbase
    const defended = enemy.buildUnit(UnitType.City, game.ref(150, 50), {});
    enemy.buildUnit(UnitType.AAGun, game.ref(155, 50), {});
    const exposed = enemy.buildUnit(UnitType.City, game.ref(150, 150), {});
    // At peace: no strike.
    expect(act()).toBe(false);

    game.addExecution(new AttackExecution(5_000, nation, enemy.id()));
    executeTicks(game, 2);
    expect(nation.outgoingAttacks().length).toBeGreaterThan(0);
    expect(act()).toBe(true);
    const bombers = nation.units(UnitType.Bomber);
    expect(bombers).toHaveLength(1);
    expect(bombers[0].warshipState().patrolTile).toBe(exposed.tile());
    expect(bombers[0].warshipState().patrolTile).not.toBe(defended.tile());
  });

  test("easy nations stay out of the air", async () => {
    await start(Difficulty.Easy);
    cities(5);
    expect(act()).toBe(false);
    expect(nation.units(UnitType.Airbase)).toHaveLength(0);
  });

  test("respects disabled units", async () => {
    game = await setup(
      MAP,
      { instantBuild: true, disabledUnits: [UnitType.Airbase] },
      [new PlayerInfo("nation", PlayerType.Human, null, "nation")],
    );
    nation = game.player("nation");
    conquerRect(nation, 0, 0, 100, 200);
    nation.addGold(50_000_000n);
    ai = new NationAirBehavior(game, nation);
    cities(4);
    expect(act()).toBe(false);
    expect(nation.units(UnitType.Airbase)).toHaveLength(0);
  });
});
