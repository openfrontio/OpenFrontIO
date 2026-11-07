import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import {
  CURE_TARGET,
  survivorBuffForTile,
} from "@openfront/engine-lib/game/ModRules";
import { TankExecution } from "@openfront/engine/execution/TankExecution";
import { ZombieRaidExecution } from "@openfront/engine/execution/ZombieRaidExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { setup } from "./util/Setup";
import { diffSnapshots, roundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

const MAP = "plains";
// 1 minute of game time.
const OUTBREAK_TICKS = 600;

let game: Game;
let p1: Player;
let p2: Player;

function claim(player: Player, x0: number, y0: number, w: number, h: number) {
  for (let x = x0; x < x0 + w; x++) {
    for (let y = y0; y < y0 + h; y++) {
      player.conquer(game.ref(x, y));
    }
  }
}

function zombie(): Player {
  const state = game.zombieRaid()!;
  return game.playerBySmallID(state.zombieSmallID) as Player;
}

describe("Zombie Raid", () => {
  beforeEach(async () => {
    game = await setup(
      MAP,
      {
        infiniteGold: true,
        instantBuild: true,
        zombieRaid: { enabled: true, outbreakMinutes: 1 },
      },
      [
        new PlayerInfo("one", PlayerType.Human, null, "p1"),
        new PlayerInfo("two", PlayerType.Human, null, "p2"),
      ],
    );
    p1 = game.player("p1");
    p2 = game.player("p2");
    claim(p1, 5, 5, 30, 30);
    claim(p2, 60, 60, 30, 30);
    p1.setSpawnTile(game.ref(10, 10));
    p2.setSpawnTile(game.ref(70, 70));
    game.addExecution(new ZombieRaidExecution(1));
  });

  function runToOutbreak() {
    executeTicks(game, OUTBREAK_TICKS + 25);
  }

  test("config resolves from the game config", () => {
    expect(game.config().zombieRaidConfig()).toEqual({
      enabled: true,
      outbreakMinutes: 1,
    });
  });

  test("nothing happens before the outbreak", () => {
    executeTicks(game, OUTBREAK_TICKS - 50);
    expect(game.zombieRaid()?.outbroken).toBe(false);
    expect(game.players().some((p) => p.name() === "Zombies")).toBe(false);
  });

  test("the outbreak creates a zombie faction that takes land from everyone", () => {
    const before1 = p1.numTilesOwned();
    const before2 = p2.numTilesOwned();
    runToOutbreak();
    const state = game.zombieRaid()!;
    expect(state.outbroken).toBe(true);
    const z = zombie();
    expect(z.numTilesOwned()).toBeGreaterThan(0);
    expect(p1.numTilesOwned()).toBeLessThan(before1);
    expect(p2.numTilesOwned()).toBeLessThan(before2);
    // Not wiped out: at most 40% of anyone's land goes in the first wave.
    expect(p1.numTilesOwned()).toBeGreaterThanOrEqual(before1 * 0.6);
  });

  test("survivor camps appear on zombie land", () => {
    runToOutbreak();
    const camps = game.units(UnitType.SurvivorCamp);
    expect(camps.length).toBeGreaterThanOrEqual(4);
    for (const camp of camps) {
      expect(game.owner(camp.tile())).toBe(zombie());
    }
  });

  test("taking a camp's land rescues its survivors for a stackable buff", () => {
    runToOutbreak();
    const camp = game.units(UnitType.SurvivorCamp)[0];
    const kind = survivorBuffForTile(camp.tile());
    p1.conquer(camp.tile());
    executeTicks(game, 20);
    const state = game.zombieRaid()!;
    expect(state.stacks(p1.smallID(), kind)).toBe(1);
    expect(state.buffPercent(p1.smallID(), kind)).toBe(5);
    expect(state.survivorsRescued).toBe(1);
    expect(camp.isActive()).toBe(false);

    // A second rescue of the same kind stacks.
    const same = game
      .units(UnitType.SurvivorCamp)
      .find((c) => survivorBuffForTile(c.tile()) === kind);
    if (same !== undefined) {
      p1.conquer(same.tile());
      executeTicks(game, 20);
      expect(state.stacks(p1.smallID(), kind)).toBe(2);
      expect(state.buffPercent(p1.smallID(), kind)).toBe(10);
    }
  });

  test("AI players do not use up survivor camps", () => {
    runToOutbreak();
    const ai = game.addPlayer(
      new PlayerInfo("ai", PlayerType.Nation, null, "ai"),
    );
    const camp = game.units(UnitType.SurvivorCamp)[0];
    ai.conquer(camp.tile());
    executeTicks(game, 20);
    expect(camp.isActive()).toBe(true);
    expect(game.zombieRaid()!.survivorsRescued).toBe(0);

    // A human taking the same land still rescues them.
    p1.conquer(camp.tile());
    executeTicks(game, 20);
    expect(camp.isActive()).toBe(false);
    expect(game.zombieRaid()!.survivorsRescued).toBe(1);
  });

  test("medic and scavenger survivors raise troop and gold income", () => {
    runToOutbreak();
    const state = game.zombieRaid()!;
    // Give p1 ten of each, p2 none, then compare a few seconds of income.
    state.buffs.set(p1.smallID(), [10, 10, 0, 0]);
    state.buffs.set(p2.smallID(), [0, 0, 0, 0]);
    p1.removeTroops(p1.troops());
    p2.removeTroops(p2.troops());
    const g1 = p1.gold();
    const g2 = p2.gold();
    executeTicks(game, 50);
    expect(p1.troops()).toBeGreaterThan(p2.troops());
    expect(p1.gold() - g1).toBeGreaterThan(p2.gold() - g2);
  });

  test("buffs are permanent and per player", () => {
    runToOutbreak();
    const camp = game.units(UnitType.SurvivorCamp)[0];
    const kind = survivorBuffForTile(camp.tile());
    p1.conquer(camp.tile());
    executeTicks(game, 600);
    const state = game.zombieRaid()!;
    expect(state.stacks(p1.smallID(), kind)).toBe(1);
    expect(state.stacks(p2.smallID(), kind)).toBe(0);
  });

  test("cure research grows with cities and airports, and cures at the target", () => {
    runToOutbreak();
    const state = game.zombieRaid()!;
    const base = state.curePoints(p1.smallID());
    expect(base).toBeGreaterThan(0);
    const lab = p1.buildUnit(UnitType.City, game.ref(8, 8), {});
    expect(lab.isActive()).toBe(true);
    const before = state.curePoints(p1.smallID());
    executeTicks(game, 100);
    const withCity = state.curePoints(p1.smallID()) - before;
    const beforeP2 = state.curePoints(p2.smallID());
    executeTicks(game, 100);
    const withoutCity = state.curePoints(p2.smallID()) - beforeP2;
    expect(withCity).toBeGreaterThan(withoutCity);

    state.cure.set(p1.smallID(), CURE_TARGET - 1);
    executeTicks(game, 20);
    expect(state.isCured(p1.smallID())).toBe(true);
    expect(state.curePoints(p1.smallID())).toBe(CURE_TARGET);
  });

  test("a cured player takes zombie land back along their border", () => {
    runToOutbreak();
    const state = game.zombieRaid()!;
    const z = zombie();
    const zombieTiles = new Set(z.tiles());
    state.cure.set(p1.smallID(), CURE_TARGET);
    executeTicks(game, 30);
    let healed = 0;
    for (const t of zombieTiles) {
      if (game.owner(t) === p1) healed++;
    }
    expect(healed).toBeGreaterThan(0);
  });

  test("an uncured player does not heal anything on their own", () => {
    runToOutbreak();
    const z = zombie();
    const zombieTiles = new Set(z.tiles());
    // No attacks are running, so without a cure p2 gains none of the horde's land.
    executeTicks(game, 30);
    let gained = 0;
    for (const t of zombieTiles) {
      if (game.owner(t) === p2) gained++;
    }
    expect(gained).toBe(0);
  });

  test("a unit that dies rises as a zombie unit, for good", () => {
    runToOutbreak();
    const tank = p1.buildUnit(UnitType.Tank, game.ref(20, 30), {
      patrolTile: game.ref(20, 30),
    });
    game.addExecution(new TankExecution(tank));
    const zombieTanksBefore = zombie().unitCount(UnitType.Tank);
    tank.modifyHealth(-10_000, p2);
    executeTicks(game, 3);
    expect(tank.isActive()).toBe(false);
    expect(zombie().unitCount(UnitType.Tank)).toBe(zombieTanksBefore + 1);
    const risen = zombie().units(UnitType.Tank)[0];
    // And a zombie that dies stays dead.
    risen.modifyHealth(-10_000, p2);
    executeTicks(game, 3);
    expect(zombie().unitCount(UnitType.Tank)).toBe(zombieTanksBefore);
  });

  test("units of cured players do not rise", () => {
    runToOutbreak();
    game.zombieRaid()!.cure.set(p1.smallID(), CURE_TARGET);
    const tank = p1.buildUnit(UnitType.Tank, game.ref(20, 30), {
      patrolTile: game.ref(20, 30),
    });
    const before = zombie().unitCount(UnitType.Tank);
    tank.modifyHealth(-10_000, p2);
    executeTicks(game, 3);
    expect(zombie().unitCount(UnitType.Tank)).toBe(before);
  });

  test("units dying before the outbreak stay dead", () => {
    const tank = p1.buildUnit(UnitType.Tank, game.ref(20, 30), {
      patrolTile: game.ref(20, 30),
    });
    tank.modifyHealth(-10_000, p2);
    runToOutbreak();
    expect(zombie().unitCount(UnitType.Tank)).toBe(0);
  });

  test("publishes a ZombieRaid update for the HUD", () => {
    runToOutbreak();
    let found: unknown;
    for (let i = 0; i < 12 && found === undefined; i++) {
      const updates = game.executeNextTick();
      found = updates[GameUpdateType.ZombieRaid]?.[0];
    }
    expect(found).toMatchObject({
      type: GameUpdateType.ZombieRaid,
      outbroken: true,
      zombieSmallID: zombie().smallID(),
    });
  });

  test("snapshots round-trip mid-outbreak and keep ticking identically", async () => {
    runToOutbreak();
    const camp = game.units(UnitType.SurvivorCamp)[0];
    p1.conquer(camp.tile());
    executeTicks(game, 20);
    const { restored } = await roundTrip(game, MAP);
    for (let i = 0; i < 40; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
    expect(restored.zombieRaid()?.survivorsRescued).toBe(
      game.zombieRaid()?.survivorsRescued,
    );
  });
});
