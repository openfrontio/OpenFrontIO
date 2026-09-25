import { AttackExecution } from "../../../src/core/execution/AttackExecution";
import { BoatRetreatExecution } from "../../../src/core/execution/BoatRetreatExecution";
import { FactoryExecution } from "../../../src/core/execution/FactoryExecution";
import { RetreatExecution } from "../../../src/core/execution/RetreatExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { TradeShipExecution } from "../../../src/core/execution/TradeShipExecution";
import { TransportShipExecution } from "../../../src/core/execution/TransportShipExecution";
import { WarshipExecution } from "../../../src/core/execution/WarshipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { executeTicks } from "../../util/utils";

function conquerRect(
  game: Game,
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      const t = game.ref(x, y);
      if (game.isLand(t)) p.conquer(t);
    }
  }
}

function humans(...ids: string[]): PlayerInfo[] {
  return ids.map((id) => new PlayerInfo(id, PlayerType.Human, null, id));
}

describe("snapshot: land attacks", () => {
  const MAP = "plains";

  async function landGame() {
    const game = await setup(MAP, { infiniteGold: true }, humans("a", "b"));
    const a = game.player("a");
    const b = game.player("b");
    conquerRect(game, a, 10, 10, 20, 20);
    conquerRect(game, b, 40, 10, 90, 40);
    a.addTroops(50_000);
    b.addTroops(5_000);
    return { game, a, b };
  }

  test("pending, then mid-conquest against terra nullius and a player", async () => {
    const { game, a, b } = await landGame();
    game.addExecution(
      new AttackExecution(20_000, a, game.terraNullius().id()),
      new AttackExecution(2_000, b, a.id()),
    );
    // Not yet initialized: still queued.
    await expectSnapshotRoundTrip(game, MAP, 3);
    executeTicks(game, 8);
    expect(a.outgoingAttacks().length).toBeGreaterThan(0);
    await expectSnapshotRoundTrip(game, MAP, 40);
    // An attack by a against b's land, while b's attack still runs.
    game.addExecution(new AttackExecution(15_000, a, b.id()));
    executeTicks(game, 4);
    await expectSnapshotRoundTrip(game, MAP, 60);
  });

  test("retreating attack", async () => {
    const { game, a, b } = await landGame();
    conquerRect(game, a, 20, 10, 40, 20);
    game.addExecution(new AttackExecution(20_000, a, b.id()));
    executeTicks(game, 5);
    const attack = a.outgoingAttacks()[0];
    expect(attack).toBeDefined();
    game.addExecution(new RetreatExecution(a, attack.id()));
    executeTicks(game, 2);
    expect(attack.retreating()).toBe(true);
    // Runs through the retreat landing.
    await expectSnapshotRoundTrip(game, MAP, 40);
  });
});

describe("snapshot: transport ships", () => {
  const MAP = "ocean_and_land";

  async function boatGame() {
    const game = await setup(
      MAP,
      { infiniteGold: true, instantBuild: true, infiniteTroops: true },
      humans("attacker", "defender"),
    );
    game.addExecution(
      new SpawnExecution(
        "game_id",
        game.player("attacker").info(),
        game.ref(0, 10),
      ),
      new SpawnExecution(
        "game_id",
        game.player("defender").info(),
        game.ref(0, 15),
      ),
    );
    executeTicks(game, 2);
    const defender = game.player("defender");
    game.addExecution(
      new AttackExecution(100, defender, game.terraNullius().id()),
    );
    game.executeNextTick();
    while (defender.outgoingAttacks().length > 0) game.executeNextTick();
    return { game, defender };
  }

  test("boat pending, mid-path and landing into an attack", async () => {
    const { game, defender } = await boatGame();
    game.addExecution(
      new TransportShipExecution(defender, game.ref(15, 8), 100),
    );
    await expectSnapshotRoundTrip(game, MAP, 2);
    executeTicks(game, 3);
    expect(defender.units(UnitType.TransportShip)).toHaveLength(1);
    // Lands and turns into a boat AttackExecution with a source tile.
    await expectSnapshotRoundTrip(game, MAP, 60);
  });

  test("retreating boat", async () => {
    const { game, defender } = await boatGame();
    game.addExecution(
      new TransportShipExecution(defender, game.ref(15, 8), 100),
    );
    executeTicks(game, 5);
    const boat = defender.units(UnitType.TransportShip)[0];
    expect(boat).toBeDefined();
    game.addExecution(new BoatRetreatExecution(defender, boat.id()));
    executeTicks(game, 2);
    expect(boat.transportShipState().isRetreating).toBe(true);
    await expectSnapshotRoundTrip(game, MAP, 40);
  });
});

describe("snapshot: warships and trade ships", () => {
  const MAP = "half_land_half_ocean";
  // Water starts just past this column.
  const coastX = 7;

  async function navalGame() {
    const game = await setup(
      MAP,
      { infiniteGold: true, instantBuild: true },
      humans("p1", "p2", "p3"),
    );
    // Past the warship's manual-move retreat lockout.
    executeTicks(game, 50);
    return {
      game,
      p1: game.player("p1"),
      p2: game.player("p2"),
      p3: game.player("p3"),
    };
  }

  test("warship patrolling from params, then retreating and docking", async () => {
    const { game, p1 } = await navalGame();
    p1.conquer(game.ref(coastX, 10));
    p1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    game.addExecution(
      new WarshipExecution({ owner: p1, patrolTile: game.ref(coastX + 4, 4) }),
    );
    // Pending, built from params on init.
    await expectSnapshotRoundTrip(game, MAP, 30);
    const warship = p1.units(UnitType.Warship)[0];
    expect(warship).toBeDefined();
    warship.modifyHealth(-Math.floor(warship.health() / 2));
    game.executeNextTick();
    expect(warship.warshipState().state).not.toBe("patrolling");
    await expectSnapshotRoundTrip(game, MAP, 40);
    expect(warship.warshipState().state).toBe("docked");
    // Docked and healing: the fractional healing remainder is state.
    await expectSnapshotRoundTrip(game, MAP, 40);
  });

  test("trade ship mid-voyage, then captured and rerouted", async () => {
    const { game, p1, p2, p3 } = await navalGame();
    conquerRect(game, p2, 0, 0, coastX + 1, 4);
    conquerRect(game, p3, 0, 12, coastX + 1, 16);
    conquerRect(game, p1, 0, 6, coastX + 1, 10);
    const src = p2.buildUnit(UnitType.Port, game.ref(coastX, 1), {});
    const dst = p3.buildUnit(UnitType.Port, game.ref(coastX, 14), {});
    p1.buildUnit(UnitType.Port, game.ref(coastX, 8), {});
    game.addExecution(new TradeShipExecution(p2, src, dst));
    await expectSnapshotRoundTrip(game, MAP, 4);
    const ship = p2.units(UnitType.TradeShip)[0];
    expect(ship).toBeDefined();
    await expectSnapshotRoundTrip(game, MAP, 2);
    p1.captureUnit(ship);
    game.executeNextTick();
    // Captured: heads for p1's port and pays out as piracy.
    await expectSnapshotRoundTrip(game, MAP, 40);
    expect(ship.owner()).toBe(p1);
    expect(ship.isActive()).toBe(false);
  });

  test("warship hunting a trade ship", async () => {
    const { game, p1, p2 } = await navalGame();
    const portTile = game.ref(coastX, 10);
    p1.buildUnit(UnitType.Port, portTile, {});
    game.addExecution(
      new WarshipExecution(
        p1.buildUnit(UnitType.Warship, portTile, { patrolTile: portTile }),
      ),
    );
    const tradeShip = p2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 7),
      {
        targetUnit: p2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );
    await expectSnapshotRoundTrip(game, MAP, 1);
    await expectSnapshotRoundTrip(game, MAP, 10);
    expect(tradeShip.owner()).toBe(p1);
  });

  test("warship shooting a transport ship", async () => {
    const { game, p1, p2 } = await navalGame();
    conquerRect(game, p2, 0, 0, coastX + 1, 4);
    p2.addTroops(1_000);
    conquerRect(game, p1, 0, 12, coastX + 1, 16);
    const warship = p1.buildUnit(UnitType.Warship, game.ref(coastX + 2, 8), {
      patrolTile: game.ref(coastX + 2, 8),
    });
    game.addExecution(new WarshipExecution(warship));
    game.addExecution(new TransportShipExecution(p2, game.ref(2, 14), 100));
    executeTicks(game, 3);
    const boat = p2.units(UnitType.TransportShip)[0];
    expect(boat).toBeDefined();
    await expectSnapshotRoundTrip(game, MAP, 40);
    // Sunk by the warship's shells before it could land.
    expect(boat.isActive()).toBe(false);
    expect(game.owner(game.ref(2, 14))).toBe(p1);
  });
});

describe("snapshot: long voyages", () => {
  const MAP = "world";

  test("trade ship across the ocean", async () => {
    const game = await setup(MAP, { instantBuild: true }, humans("a", "b"));
    const a = game.player("a");
    const b = game.player("b");
    a.addGold(10_000_000n);
    b.addGold(10_000_000n);
    const port = (p: Player, x: number, y: number) => {
      for (let dx = -5; dx <= 5; dx++) {
        for (let dy = -5; dy <= 5; dy++) {
          const t = game.ref(x + dx, y + dy);
          if (game.isLand(t)) p.conquer(t);
        }
      }
      const spawn = p.canBuild(UnitType.Port, game.ref(x, y));
      if (spawn === false) throw new Error("cannot build port");
      return p.buildUnit(UnitType.Port, spawn, {});
    };
    const src = port(a, 539, 380);
    const dst = port(b, 832, 341);
    game.addExecution(new TradeShipExecution(a, src, dst));
    executeTicks(game, 30);
    expect(a.units(UnitType.TradeShip)).toHaveLength(1);
    await expectSnapshotRoundTrip(game, MAP, 60);
  }, 60_000);
});

describe("snapshot: trains", () => {
  const MAP = "plains";

  test("trains mid-route", async () => {
    const game = await setup(MAP, { instantBuild: true }, humans("a"));
    const a = game.player("a");
    a.addGold(100_000_000n);
    conquerRect(game, a, 5, 30, 95, 70);
    for (const [x, y] of [
      [20, 50],
      [80, 50],
      [50, 35],
    ]) {
      a.buildUnit(UnitType.City, game.ref(x, y), {});
    }
    const factory = a.buildUnit(UnitType.Factory, game.ref(50, 50), {});
    game.addExecution(new FactoryExecution(factory));
    let ticks = 0;
    while (game.units(UnitType.Train).length === 0 && ticks < 3000) {
      game.executeNextTick();
      ticks++;
    }
    expect(game.units(UnitType.Train).length).toBeGreaterThan(0);
    executeTicks(game, 3);
    await expectSnapshotRoundTrip(game, MAP, 80);
    // Later, with more trains on the network and some mid-stop.
    executeTicks(game, 400);
    await expectSnapshotRoundTrip(game, MAP, 80);
  }, 60_000);
});
