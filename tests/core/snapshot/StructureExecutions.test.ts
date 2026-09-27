import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import { DoomsdayClockExecution } from "../../../src/core/execution/DoomsdayClockExecution";
import { MirvExecution } from "../../../src/core/execution/MIRVExecution";
import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import { PortExecution } from "../../../src/core/execution/PortExecution";
import { SAMLauncherExecution } from "../../../src/core/execution/SAMLauncherExecution";
import { ShellExecution } from "../../../src/core/execution/ShellExecution";
import { TrainStationExecution } from "../../../src/core/execution/TrainStationExecution";
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

const BIG = "big_plains";

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

async function twoPlayers(
  map: string,
  config: Parameters<typeof setup>[1] = {},
): Promise<{ game: Game; a: Player; b: Player }> {
  const game = await setup(map, { infiniteGold: true, ...config }, [
    new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
    new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
  ]);
  return { game, a: game.player("alice"), b: game.player("bob") };
}

describe("structure and missile execution snapshots", () => {
  test("construction mid-build, pending, and captured", async () => {
    const { game, a, b } = await twoPlayers(BIG);
    conquerRect(game, a, 0, 0, 40, 40);
    conquerRect(game, b, 60, 0, 100, 40);
    game.addExecution(
      new ConstructionExecution(a, UnitType.City, game.ref(10, 10)),
      new ConstructionExecution(a, UnitType.SAMLauncher, game.ref(25, 25)),
      new ConstructionExecution(b, UnitType.Port, game.ref(70, 10)),
    );
    executeTicks(game, 3);
    const city = a.units(UnitType.City)[0];
    expect(city.isUnderConstruction()).toBe(true);
    // Captured mid-build: the construction follows the new owner.
    b.conquer(city.tile());
    executeTicks(game, 1);
    // Queued but not yet initialized.
    game.addExecution(
      new ConstructionExecution(a, UnitType.MissileSilo, game.ref(30, 5)),
      new ConstructionExecution(
        a,
        UnitType.AtomBomb,
        game.ref(80, 20),
        false,
        2,
      ),
    );
    await expectSnapshotRoundTrip(game, BIG, 80);
  });

  test("nukes in flight, waiting and pending", async () => {
    const { game, a, b } = await twoPlayers(BIG, { instantBuild: true });
    conquerRect(game, a, 0, 0, 30, 30);
    conquerRect(game, b, 50, 50, 120, 120);
    a.buildUnit(UnitType.MissileSilo, game.ref(10, 10), {});
    a.buildUnit(UnitType.MissileSilo, game.ref(20, 20), {});
    a.buildUnit(UnitType.MissileSilo, game.ref(25, 5), {});
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, a, game.ref(80, 80)),
      new NukeExecution(UnitType.HydrogenBomb, a, game.ref(100, 60)),
      new NukeExecution(
        UnitType.AtomBomb,
        a,
        game.ref(70, 90),
        null,
        -1,
        5,
        false,
      ),
    );
    executeTicks(game, 6);
    expect(a.units(UnitType.AtomBomb).length).toBe(2);
    expect(a.units(UnitType.HydrogenBomb).length).toBe(1);
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, a, game.ref(60, 60), game.ref(5, 5)),
    );
    await expectSnapshotRoundTrip(game, BIG, 120);
  });

  test("MIRV before and after warheads separate", async () => {
    const { game, a, b } = await twoPlayers(BIG, { instantBuild: true });
    conquerRect(game, a, 0, 0, 15, 15);
    conquerRect(game, b, 25, 25, 200, 200);
    a.buildUnit(UnitType.MissileSilo, game.ref(10, 10), {});
    const pending = new MirvExecution(a, game.ref(100, 100));
    game.addExecution(new MirvExecution(a, game.ref(150, 150)));
    executeTicks(game, 3);
    // Still climbing, staging targets soon.
    await expectSnapshotRoundTrip(game, BIG, 2);

    game.addExecution(pending);
    let ticks = 0;
    while (a.units(UnitType.MIRVWarhead).length === 0 && ticks++ < 500) {
      game.executeNextTick();
    }
    expect(a.units(UnitType.MIRVWarhead).length).toBeGreaterThan(0);
    expect(a.units(UnitType.MIRV).length).toBe(1);
    await expectSnapshotRoundTrip(game, BIG, 25);
  }, 60_000);

  test("SAM targeting and intercepting", async () => {
    const { game, a, b } = await twoPlayers(BIG, { instantBuild: true });
    conquerRect(game, a, 0, 0, 20, 20);
    conquerRect(game, b, 60, 60, 140, 140);
    a.buildUnit(UnitType.MissileSilo, game.ref(10, 10), {});
    const sam = b.buildUnit(UnitType.SAMLauncher, game.ref(90, 90), {});
    game.addExecution(
      new SAMLauncherExecution(b, null, sam),
      // Built by the execution itself on its first tick.
      new SAMLauncherExecution(b, game.ref(120, 120)),
    );
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, a, game.ref(92, 92)),
      new NukeExecution(UnitType.AtomBomb, a, game.ref(95, 88)),
      new NukeExecution(UnitType.HydrogenBomb, a, game.ref(118, 118)),
    );
    // Nukes climbing: interceptions are scheduled but not yet due.
    executeTicks(game, 5);
    await expectSnapshotRoundTrip(game, BIG, 1);
    let ticks = 0;
    while (b.units(UnitType.SAMMissile).length === 0 && ticks++ < 300) {
      game.executeNextTick();
    }
    // A missile in flight, more nukes cached in the targeting system.
    expect(b.units(UnitType.SAMMissile).length).toBeGreaterThan(0);
    await expectSnapshotRoundTrip(game, BIG, 60);
  });

  test("shells in flight", async () => {
    const { game, a, b } = await twoPlayers(BIG, { instantBuild: true });
    conquerRect(game, a, 0, 0, 20, 20);
    const post = a.buildUnit(UnitType.DefensePost, game.ref(10, 10), {});
    const target = b.buildUnit(UnitType.TransportShip, game.ref(40, 30), {
      troops: 100,
    });
    const tank = b.buildUnit(UnitType.TransportShip, game.ref(12, 30), {
      troops: 100000,
    });
    game.addExecution(
      new ShellExecution(game.ref(10, 10), a, post, target),
      new ShellExecution(game.ref(10, 10), a, post, tank),
    );
    executeTicks(game, 3);
    expect(a.units(UnitType.Shell).length).toBe(2);
    // Pending shell; and a destroyed firing unit starts the shell lifetime.
    game.addExecution(new ShellExecution(game.ref(10, 10), a, post, tank));
    await expectSnapshotRoundTrip(game, BIG, 2);
    post.delete(false);
    executeTicks(game, 2);
    await expectSnapshotRoundTrip(game, BIG, 30);
  });

  test("ports spawning trade ships", async () => {
    const map = "world";
    const { game, a, b } = await twoPlayers(map, { instantBuild: true });
    const port = (p: Player, x: number, y: number) => {
      conquerRect(game, p, x - 5, y - 5, x + 6, y + 6);
      const spawn = p.canBuild(UnitType.Port, game.ref(x, y));
      if (spawn === false) throw new Error("cannot build port");
      return p.buildUnit(UnitType.Port, spawn, {});
    };
    const src = port(a, 539, 380);
    src.increaseLevel();
    const dst = port(b, 832, 341);
    game.addExecution(new PortExecution(src), new PortExecution(dst));
    let ticks = 0;
    while (game.unitCount(UnitType.TradeShip) === 0 && ticks++ < 2000) {
      game.executeNextTick();
    }
    expect(game.unitCount(UnitType.TradeShip)).toBeGreaterThan(0);
    // An execution still pending init (a second one on a port is harmless).
    game.addExecution(new PortExecution(dst));
    await expectSnapshotRoundTrip(game, map, 80);
  }, 60_000);

  test("train stations", async () => {
    const { game, a } = await twoPlayers(BIG, { instantBuild: true });
    conquerRect(game, a, 0, 0, 60, 60);
    const factory = a.buildUnit(UnitType.Factory, game.ref(10, 10), {});
    const city = a.buildUnit(UnitType.City, game.ref(30, 12), {});
    game.addExecution(
      new TrainStationExecution(factory, true),
      new TrainStationExecution(city),
    );
    executeTicks(game, 5);
    expect(factory.hasTrainStation()).toBe(true);
    let ticks = 0;
    while (game.unitCount(UnitType.Train) === 0 && ticks++ < 3000) {
      game.executeNextTick();
    }
    expect(game.unitCount(UnitType.Train)).toBeGreaterThan(0);
    const city2 = a.buildUnit(UnitType.City, game.ref(12, 35), {});
    game.addExecution(new TrainStationExecution(city2));
    await expectSnapshotRoundTrip(game, BIG, 20);
  });

  test("doomsday clock rotting a side", async () => {
    const game = await setup(
      "plains",
      {
        instantBuild: true,
        doomsdayClock: { enabled: true, speed: "veryfast" },
      },
      [
        new PlayerInfo("big", PlayerType.Human, null, "big"),
        new PlayerInfo("small", PlayerType.Human, null, "small"),
      ],
    );
    const big = game.player("big");
    const small = game.player("small");
    let n = 0;
    for (let y = 0; y < game.height(); y++) {
      for (let x = 0; x < game.width(); x++) {
        const t = game.ref(x, y);
        if (!game.isLand(t)) continue;
        if (n < 4000) big.conquer(t);
        else if (n < 4200) small.conquer(t);
        n++;
      }
    }
    const pending = new DoomsdayClockExecution();
    // Snapshotted before init too.
    game.addExecution(new DoomsdayClockExecution());
    await expectSnapshotRoundTrip(game, "plains", 1);
    let ticks = 0;
    while (!small.isDecaying() && ticks++ < 20_000) game.executeNextTick();
    expect(small.isDecaying()).toBe(true);
    executeTicks(game, 25);
    game.addExecution(pending);
    await expectSnapshotRoundTrip(game, "plains", 60);
  }, 60_000);
});
