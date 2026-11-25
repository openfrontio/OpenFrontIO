import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { SnapshotError } from "@openfront/engine-lib/snapshot/SnapshotType";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { DoomsdayClockExecution } from "@openfront/engine/execution/DoomsdayClockExecution";
import { MirvExecution } from "@openfront/engine/execution/MIRVExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { TrainStationExecution } from "@openfront/engine/execution/TrainStationExecution";
import { TransportShipExecution } from "@openfront/engine/execution/TransportShipExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { GameImpl } from "@openfront/engine/game/GameImpl";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import {
  decodeSnapshotValue,
  encodeSnapshotValue,
} from "@openfront/engine/snapshot/SnapshotCodec";
import { setup } from "../../util/Setup";
import { restoreTestGame } from "../../util/Snapshot";
import { executeTicks } from "../../util/utils";

/**
 * Snapshots are shared as scenarios, so every field is untrusted. Each test
 * edits a valid snapshot the way an attacker could, past the codec and the
 * record schemas' types, and expects restore to refuse it with a
 * SnapshotError instead of crashing, hanging or corrupting the game later.
 */

type Root = any;

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

/** A fixture: a game's snapshot, decoded fresh for each edit. */
function fixture(game: Game, map: string) {
  const bytes = snapshotGame(game);
  return {
    map,
    root: (): Root => decodeSnapshotValue(bytes),
    restores: () => restoreTestGame(bytes, map),
  };
}
type Fixture = ReturnType<typeof fixture>;

async function expectRejected(
  f: Fixture,
  edit: (root: Root) => void,
  message: RegExp,
): Promise<void> {
  const root = f.root();
  edit(root);
  let error: unknown = null;
  try {
    await restoreTestGame(encodeSnapshotValue(root), f.map);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(SnapshotError);
  expect((error as Error).message).toMatch(message);
}

const exec = (root: Root, t: string) => {
  const e = root.execs.find((x: { t: string }) => x.t === t);
  expect(e).toBeDefined();
  return e.d;
};

describe("hostile snapshots: core state", () => {
  const MAP = "plains";
  let f: Fixture;

  beforeAll(async () => {
    const game = await setup(MAP, { infiniteGold: true, instantBuild: true });
    const a = game.addPlayer(
      new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
    );
    const b = game.addPlayer(
      new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
    );
    const bot = game.addPlayer(
      new PlayerInfo("bot", PlayerType.Bot, null, "bot"),
    );
    conquerRect(game, a, 5, 5, 15, 15);
    conquerRect(game, b, 20, 5, 30, 15);
    a.buildUnit(UnitType.City, game.ref(8, 8), {});
    a.buildUnit(UnitType.City, game.ref(12, 12), {});
    const g = game as GameImpl;
    g.createAllianceRequest(a, b)?.accept();
    g.createAllianceRequest(b, bot);
    game.setFallout(game.ref(40, 40), true);
    game.addExecution(new WinCheckExecution());
    executeTicks(game, 3);
    f = fixture(game, MAP);
  });

  test("the unedited snapshot restores", async () => {
    await f.restores();
  });

  test("tiles off the map", async () => {
    await expectRejected(
      f,
      (r) => (r.players[0].d.tiles[0] = 100 * 100),
      /tiles on the map/,
    );
    await expectRejected(
      f,
      (r) => (r.units[0].d.tile = 100 * 100),
      /tile is off the map/,
    );
  });

  test("terrain edits that do not line up", async () => {
    await expectRejected(
      f,
      (r) => (r.map.d.editTiles = Uint32Array.of(5)),
      /terrain edit lists differ/,
    );
  });

  test("fallout and land counts that differ from the map", async () => {
    await expectRejected(
      f,
      (r) => (r.map.d.numTilesWithFallout = 2),
      /fallout count/,
    );
    await expectRejected(
      f,
      (r) => (r.map.d.numLandTiles = 9_999),
      /land tile count/,
    );
    await expectRejected(
      f,
      (r) => {
        const [t] = r.map.d.fallout as Uint32Array;
        r.map.d.fallout = Uint32Array.of(t, t);
        r.map.d.numTilesWithFallout = 2;
      },
      /fallout count/,
    );
  });

  test("an owned tile with fallout", async () => {
    await expectRejected(
      f,
      (r) => (r.players[0].d.tiles[0] = r.map.d.fallout[0]),
      /with fallout/,
    );
  });

  test("player small ids with a gap, a duplicate or a stale next id", async () => {
    await expectRejected(f, (r) => (r.players[1].d.smallID = 4), /small id/);
    await expectRejected(
      f,
      (r) => (r.players[1].d.info.id = "alice"),
      /stored twice/,
    );
    await expectRejected(
      f,
      (r) => (r.game.d.nextPlayerID = 2),
      /next player id/,
    );
  });

  test("player ids that are Object.prototype keys", async () => {
    await expectRejected(
      f,
      (r) => (r.players[0].d.info.clientID = "__proto__"),
      /reserved id/,
    );
    await expectRejected(
      f,
      (r) => (r.players[0].d.info.id = "constructor"),
      /reserved id/,
    );
  });

  test("a tile with two owners", async () => {
    await expectRejected(
      f,
      (r) => {
        const tiles = r.players[1].d.tiles as Uint32Array;
        tiles[0] = r.players[0].d.tiles[0];
      },
      /two owners/,
    );
  });

  test("a border tile the player does not own", async () => {
    await expectRejected(
      f,
      (r) => (r.players[0].d.borderTiles[0] = 50 * 100 + 50),
      /border tile .* unowned/,
    );
  });

  test("units the players, the game and the unit grid disagree on", async () => {
    // Owned by bob, but listed by alice.
    await expectRejected(f, (r) => (r.units[0].d.owner = 2), /lists unit/);
    await expectRejected(
      f,
      (r) => (r.units[0].d.active = false),
      /lists unit|the game does not/,
    );
    await expectRejected(f, (r) => r.game.d.unitGrid.pop(), /unit grid has/);
    // Two unit rows with one id.
    await expectRejected(
      f,
      (r) => {
        r.units.push(structuredClone(r.units[0]));
        r.game.d.units.push(1);
        r.players[0].d.units.push(1);
      },
      /share an id|the game does not/,
    );
    // Listed twice by its owner, so the owner's other unit is in no list.
    await expectRejected(
      f,
      (r) => {
        const units = r.players[0].d.units;
        expect(units.length).toBe(2);
        units[1] = units[0];
      },
      /listed twice/,
    );
    // The next unit built would take a live unit's id.
    await expectRejected(
      f,
      (r) => (r.game.d.nextUnitID = 1),
      /past next unit id/,
    );
    // Past 2^53, incrementing it stops changing it, so ids repeat.
    await expectRejected(
      f,
      (r) => (r.game.d.nextUnitID = Number.MAX_SAFE_INTEGER),
      /next unit id is/,
    );
  });

  test("alliances listed once, twice by one player, or with oneself", async () => {
    await expectRejected(
      f,
      (r) => (r.players[0].d.alliances = []),
      /listed by only one player/,
    );
    await expectRejected(
      f,
      (r) => r.players[0].d.alliances.push(r.players[0].d.alliances[0]),
      /allied twice/,
    );
    await expectRejected(
      f,
      (r) => (r.alliances[0].d.recipient = 1),
      /not its own|allied twice|only one/,
    );
  });

  test("alliance requests to oneself, to an ally, or twice", async () => {
    const pending = (r: Root) =>
      r.allianceRequests[r.game.d.allianceRequests[0]].d;
    await expectRejected(
      f,
      (r) => (pending(r).recipient = pending(r).requestor),
      /invalid alliance request/,
    );
    await expectRejected(
      f,
      (r) => (pending(r).recipient = 1),
      /invalid alliance request/,
    );
    await expectRejected(
      f,
      (r) => r.game.d.allianceRequests.push(r.game.d.allianceRequests[0]),
      /invalid alliance request/,
    );
  });

  test("an execution listed twice", async () => {
    await expectRejected(
      f,
      (r) => r.game.d.execs.push(r.game.d.execs[0]),
      /execution is listed twice/,
    );
  });

  test("stats that are not bigints", async () => {
    await expectRejected(
      f,
      (r) => (r.game.d.stats.d.data = { alice: { attacks: [1, 2, 3] } }),
      /malformed player stats/,
    );
  });

  test("a dirty minimap tile off the minimap", async () => {
    await expectRejected(
      f,
      (r) => (r.game.d.water.d.dirtyMiniTiles = Uint32Array.of(50 * 50)),
      /off the minimap/,
    );
  });
});

describe("hostile snapshots: water", () => {
  const MAP = "half_land_half_ocean";
  let f: Fixture;
  let ocean = -1;

  beforeAll(async () => {
    const game = await setup(
      MAP,
      { waterNukes: true, disableNavMesh: false },
      humans("a"),
    );
    const map = game.map();
    const land: number[] = [];
    map.forEachTile((t) => {
      if (map.isLand(t)) land.push(t);
      else if (ocean < 0) ocean = t;
    });
    // Flood all but one land tile, which a player holds: the minimap
    // changes too, so the snapshot stores its water components.
    const kept = land.pop()!;
    game.player("a").conquer(kept);
    for (const t of land) game.queueWaterConversion(t);
    game.executeNextTick();
    expect(map.isWater(land[0])).toBe(true);
    f = fixture(game, MAP);
  });

  test("the unedited snapshot restores", async () => {
    const root = f.root();
    expect(root.game.d.water.d.components).not.toBeNull();
    await f.restores();
  });

  test("an owned water tile", async () => {
    await expectRejected(
      f,
      (r) => {
        const tiles = r.players[0].d.tiles as Uint32Array;
        tiles[0] = ocean;
      },
      /not land/,
    );
  });

  test("water components whose parents form a cycle", async () => {
    await expectRejected(
      f,
      (r) => {
        const c = r.game.d.water.d.components;
        c.maxId = Math.max(c.maxId, 2);
        c.parents = [0, 2, 1];
        c.componentSizes.length = c.maxId + 1;
        c.parents.length = c.maxId + 1;
        c.parents.fill(0, 3);
      },
      /water components are inconsistent/,
    );
  });

  test("water components merged into no component, or a negative size", async () => {
    await expectRejected(
      f,
      (r) => {
        const c = r.game.d.water.d.components;
        expect(c.maxId).toBeGreaterThan(0);
        c.parents[0] = c.maxId;
      },
      /water components are inconsistent/,
    );
    await expectRejected(
      f,
      (r) => {
        const c = r.game.d.water.d.components;
        c.parents[c.maxId] = 0;
      },
      /water components are inconsistent/,
    );
    await expectRejected(
      f,
      (r) => (r.game.d.water.d.components.componentSizes[1] = -1),
      /water components are inconsistent/,
    );
  });

  test("water component labels past the last id", async () => {
    await expectRejected(
      f,
      (r) => {
        const c = r.game.d.water.d.components;
        c.componentIds[0] = c.maxId + 1;
      },
      /water components are inconsistent/,
    );
  });
});

describe("hostile snapshots: executions", () => {
  const MAP = "big_plains";
  let f: Fixture;

  beforeAll(async () => {
    const game = await setup(
      MAP,
      { infiniteGold: true, instantBuild: true },
      humans("a", "b"),
    );
    const a = game.player("a");
    const b = game.player("b");
    conquerRect(game, a, 0, 0, 60, 60);
    conquerRect(game, b, 100, 100, 200, 200);
    a.addTroops(50_000);
    a.buildUnit(UnitType.MissileSilo, game.ref(10, 10), {});
    const factory = a.buildUnit(UnitType.Factory, game.ref(10, 40), {});
    const city = a.buildUnit(UnitType.City, game.ref(30, 42), {});
    game.addExecution(
      new TrainStationExecution(factory, true),
      new TrainStationExecution(city),
    );
    let ticks = 0;
    while (game.unitCount(UnitType.Train) === 0 && ticks++ < 3000) {
      game.executeNextTick();
    }
    expect(game.unitCount(UnitType.Train)).toBeGreaterThan(0);
    game.addExecution(
      new AttackExecution(20_000, a, game.terraNullius().id()),
      new MirvExecution(a, game.ref(150, 150)),
    );
    executeTicks(game, 3);
    // Queued, not yet initialized.
    game.addExecution(
      new ConstructionExecution(a, UnitType.AtomBomb, game.ref(150, 150)),
    );
    f = fixture(game, MAP);
  }, 60_000);

  test("the unedited snapshot restores", async () => {
    await f.restores();
  });

  test("a unit in another cell of the unit grid than its tile's", async () => {
    await expectRejected(
      f,
      (r) => {
        const silo = r.units.find(
          (u: Root) => u.d.type === UnitType.MissileSilo,
        ).d;
        silo.tile = silo.lastTile = 150 * 200 + 150;
      },
      /unit grid misplaces/,
    );
  });

  test("an attack queue sized past the map", async () => {
    await expectRejected(
      f,
      (r) => (exec(r, "Attack").toConquer.capacity = 2 ** 30),
      /invalid attack queue/,
    );
    await expectRejected(
      f,
      (r) => (exec(r, "Attack").toConquer.capacity = 1000),
      /invalid attack queue/,
    );
  });

  test("troop counts that are not finite", async () => {
    await expectRejected(
      f,
      (r) => (r.attacks[0].d.troops = NaN),
      /Attack v\d+: invalid data/,
    );
    await expectRejected(
      f,
      (r) => (exec(r, "Attack").startTroops = Infinity),
      /invalid data/,
    );
    // Finite, but two of them merged overflow to Infinity.
    await expectRejected(
      f,
      (r) => (r.attacks[0].d.troops = 1e308),
      /Attack v\d+: invalid data/,
    );
  });

  test("a MIRV with a different warhead count or range", async () => {
    await expectRejected(
      f,
      (r) => (exec(r, "MIRV").warheadCount = 1e7),
      /invalid MIRV state/,
    );
    await expectRejected(
      f,
      (r) => (exec(r, "MIRV").minimumSpread = 0),
      /invalid MIRV state/,
    );
  });

  test("a parabola that is not the one to its target", async () => {
    const curve = (r: Root) => exec(r, "MIRV").launch.pathFinder.curve;
    // Points far apart size the curve's precomputed flight.
    await expectRejected(
      f,
      (r) => (curve(r).points[0] = { x: 1e9, y: 0 }),
      /no start or end/,
    );
    await expectRejected(
      f,
      (r) => (curve(r).points[3] = { x: 1e9, y: 1e9 }),
      /not the one to its target/,
    );
    // Stepped up one at a time to the curve's start.
    await expectRejected(
      f,
      (r) => (curve(r).currentIndex = -9e15),
      /off its curve/,
    );
    await expectRejected(
      f,
      (r) => (curve(r).currentIndex = 1e6),
      /off its curve/,
    );
    await expectRejected(
      f,
      (r) => (exec(r, "MIRV").launch.pathFinder.options.increment = 0),
      /parabola increment/,
    );
    // next() would step the missing curve.
    await expectRejected(
      f,
      (r) => {
        const pf = exec(r, "MIRV").launch.pathFinder;
        expect(pf.lastTo).not.toBeNull();
        pf.curve = null;
      },
      /target but no curve/,
    );
  });

  test("a construction amount past the upgrade cap", async () => {
    await expectRejected(
      f,
      (r) => (exec(r, "Construction").amount = 1e9),
      /invalid data/,
    );
  });

  test("a train with more cars than it builds", async () => {
    await expectRejected(
      f,
      (r) => (exec(r, "Train").numCars = 1e9),
      /invalid data/,
    );
    await expectRejected(
      f,
      (r) => (exec(r, "TrainStation").numCars = 1e9),
      /invalid data/,
    );
  });

  test("train station ids off the station table", async () => {
    await expectRejected(
      f,
      (r) => (r.game.d.rail.d.stationManager.nextId = 2 ** 30),
      /next station id/,
    );
    await expectRejected(
      f,
      (r) => (r.stations[0].d.id = r.game.d.rail.d.stationManager.nextId),
      /invalid train station id/,
    );
    await expectRejected(
      f,
      (r) => (r.stations[1].d.id = r.stations[0].d.id),
      /invalid train station id/,
    );
  });
});

describe("hostile snapshots: transport ships", () => {
  const MAP = "ocean_and_land";
  let f: Fixture;

  beforeAll(async () => {
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
    game.addExecution(
      new TransportShipExecution(defender, game.ref(15, 8), 100),
    );
    executeTicks(game, 3);
    f = fixture(game, MAP);
  });

  test("the unedited snapshot restores", async () => {
    await f.restores();
  });

  test("a path index off the path", async () => {
    await expectRejected(
      f,
      (r) => (exec(r, "TransportShip").pathFinder.stepper.pathIndex = 1e6),
      /path index .* is off a path/,
    );
    await expectRejected(
      f,
      (r) => (exec(r, "TransportShip").pathFinder.stepper.pathIndex = -1),
      /path index .* is off a path/,
    );
  });

  test("boat troops that are not finite", async () => {
    await expectRejected(
      f,
      (r) => (exec(r, "TransportShip").troops = NaN),
      /invalid data/,
    );
  });
});

describe("hostile snapshots: doomsday clock", () => {
  const MAP = "plains";
  let f: Fixture;

  beforeAll(async () => {
    const game = await setup(
      MAP,
      { doomsdayClock: { enabled: true, speed: "veryfast" } },
      humans("big", "small"),
    );
    conquerRect(game, game.player("big"), 0, 0, 40, 100);
    conquerRect(game, game.player("small"), 60, 0, 62, 100);
    game.addExecution(new DoomsdayClockExecution());
    executeTicks(game, 2);
    f = fixture(game, MAP);
  });

  const rot = (over: object) => (r: Root) =>
    exec(r, "DoomsdayClock").rotState.push({
      player: 2,
      since: 0,
      held: 200,
      frontTiles: Uint32Array.of(60, 61),
      frontRotted: [1, 1],
      ...over,
    });

  test("the unedited and a valid edited snapshot restore", async () => {
    await f.restores();
    const root = f.root();
    rot({})(root);
    await restoreTestGame(encodeSnapshotValue(root), MAP);
  });

  test("rot state that does not fit the map or its front", async () => {
    await expectRejected(f, rot({ held: 1e9 }), /doomsday clock rot state/);
    await expectRejected(f, rot({ held: -1 }), /doomsday clock rot state/);
    await expectRejected(
      f,
      rot({ frontRotted: [1] }),
      /doomsday clock rot state/,
    );
    await expectRejected(
      f,
      rot({ frontRotted: [1, -5] }),
      /doomsday clock rot state/,
    );
  });
});
