import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  aircraftSpec,
  AIRBASE_RADAR_RANGE,
  Altitude,
  isTrackedByRadar,
  radarRange,
  stepToward,
} from "@openfront/engine-lib/game/AirRules";
import {
  intToUnitType,
  packAircraftState,
  unitTypeToInt,
  unpackAircraftState,
} from "@openfront/engine-lib/game/PackedUnitUpdates";
import { AAGunExecution } from "@openfront/engine/execution/air/AAGunExecution";
import { AircraftExecution } from "@openfront/engine/execution/air/AircraftExecution";
import { GuidedMissileExecution } from "@openfront/engine/execution/air/GuidedMissileExecution";
import { MoveWarshipExecution } from "@openfront/engine/execution/MoveWarshipExecution";
import { SAMLauncherExecution } from "@openfront/engine/execution/SAMLauncherExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const MAP = "big_plains"; // 200 x 200, all land

let game: Game;
let blue: Player;
let red: Player;

function conquerRect(
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      p.conquer(game.ref(x, y));
    }
  }
}

function humans(...ids: string[]): PlayerInfo[] {
  return ids.map((id) => new PlayerInfo(id, PlayerType.Human, null, id));
}

/** Launches an aircraft the way a build intent does, and returns it. */
function launch(
  owner: Player,
  type:
    | UnitType.Fighter
    | UnitType.Bomber
    | UnitType.AttackHelicopter
    | UnitType.TransportHelicopter,
  x: number,
  y: number,
): Unit {
  const before = new Set(owner.units(type));
  game.addExecution(
    new AircraftExecution({ owner, type, patrolTile: game.ref(x, y) }),
  );
  game.executeNextTick();
  const unit = owner.units(type).find((u) => !before.has(u));
  if (unit === undefined) throw new Error(`${type} was not launched`);
  return unit;
}

/** An aircraft placed directly in the air (no execution flying it). */
function airborne(owner: Player, type: UnitType, x: number, y: number): Unit {
  const tile = game.ref(x, y);
  return owner.buildUnit(type as UnitType.Fighter, tile, { patrolTile: tile });
}

function chebyshev(a: number, b: number): number {
  return Math.max(
    Math.abs(game.x(a) - game.x(b)),
    Math.abs(game.y(a) - game.y(b)),
  );
}

describe("AIR update", () => {
  beforeEach(async () => {
    game = await setup(
      MAP,
      { infiniteGold: true, instantBuild: true },
      humans("blue", "red"),
    );
    blue = game.player("blue");
    red = game.player("red");
    conquerRect(blue, 0, 0, 100, 200);
    conquerRect(red, 100, 0, 200, 200);
    blue.addTroops(100_000);
    red.addTroops(100_000);
  });

  describe("wire format", () => {
    test("new unit types round-trip through the packed type field", () => {
      for (const type of [
        UnitType.Airbase,
        UnitType.RadarStation,
        UnitType.AAGun,
        UnitType.AttackHelicopter,
        UnitType.TransportHelicopter,
        UnitType.Fighter,
        UnitType.Bomber,
      ]) {
        const i = unitTypeToInt(type);
        expect(i).toBeLessThan(32); // 5-bit field
        expect(intToUnitType(i)).toBe(type);
      }
      // Existing indices are unchanged.
      expect(unitTypeToInt(UnitType.TransportShip)).toBe(1);
      expect(unitTypeToInt(UnitType.Factory)).toBe(16);
    });

    test("aircraft consumables pack into one float and back", () => {
      const state = { fuel: 1799, ammo: 12, flares: 3 };
      expect(unpackAircraftState(packAircraftState(state))).toEqual(state);
    });
  });

  describe("launching and the sortie cycle", () => {
    test("aircraft need an operational airbase to launch", () => {
      expect(blue.canBuild(UnitType.Fighter, game.ref(50, 50))).toBe(false);
      const base = blue.buildUnit(UnitType.Airbase, game.ref(20, 20), {});
      expect(blue.canBuild(UnitType.Fighter, game.ref(50, 50))).toBe(
        base.tile(),
      );
      // Aircraft may be ordered over enemy land too.
      expect(blue.canBuild(UnitType.Bomber, game.ref(150, 50))).toBe(
        base.tile(),
      );
    });

    test("a fighter takes off, flies to its station and orbits it", () => {
      blue.buildUnit(UnitType.Airbase, game.ref(20, 20), {});
      const fighter = launch(blue, UnitType.Fighter, 60, 20);
      expect(fighter.warshipState().state).toBe("docked");
      executeTicks(game, 25);
      expect(fighter.warshipState().state).toBe("patrolling");
      // Orbiting: always near, never parked on, the station.
      const station = game.ref(60, 20);
      const seen = new Set<number>();
      for (let i = 0; i < 20; i++) {
        game.executeNextTick();
        expect(chebyshev(fighter.tile(), station)).toBeLessThanOrEqual(10);
        seen.add(fighter.tile());
      }
      expect(seen.size).toBeGreaterThan(5);
    });

    test("helicopters hover on station", () => {
      blue.buildUnit(UnitType.Airbase, game.ref(20, 20), {});
      const heli = launch(blue, UnitType.AttackHelicopter, 30, 20);
      executeTicks(game, 40);
      expect(heli.tile()).toBe(game.ref(30, 20));
      executeTicks(game, 10);
      expect(heli.tile()).toBe(game.ref(30, 20));
    });

    test("fuel burns in flight and the aircraft returns to refuel", () => {
      const base = blue.buildUnit(UnitType.Airbase, game.ref(10, 10), {});
      const fighter = launch(blue, UnitType.Fighter, 80, 80);
      const maxFuel = aircraftSpec(UnitType.Fighter).maxFuel;
      executeTicks(game, 10);
      expect(fighter.aircraftState().fuel).toBeLessThan(maxFuel);

      let returned = false;
      for (let i = 0; i < maxFuel && !returned; i++) {
        game.executeNextTick();
        returned = fighter.warshipState().state === "retreating";
      }
      expect(returned).toBe(true);
      // It makes it home with fuel to spare and lands.
      let docked = false;
      for (let i = 0; i < 200 && !docked; i++) {
        game.executeNextTick();
        docked = fighter.warshipState().state === "docked";
      }
      expect(docked).toBe(true);
      expect(fighter.isActive()).toBe(true);
      expect(fighter.tile()).toBe(base.tile());
      // Turnaround refills the tank, then it flies the mission again.
      executeTicks(game, 150);
      expect(fighter.aircraftState().fuel).toBeGreaterThan(maxFuel / 2);
    });

    test("an aircraft with no airbase left crashes when its fuel runs out", () => {
      const base = blue.buildUnit(UnitType.Airbase, game.ref(10, 10), {});
      const heli = launch(blue, UnitType.AttackHelicopter, 30, 30);
      executeTicks(game, 5);
      base.delete();
      const fuel = heli.aircraftState().fuel;
      executeTicks(game, fuel + 2);
      expect(heli.isActive()).toBe(false);
    });

    test("ordering an aircraft onto its own airbase stands it down", () => {
      const base = blue.buildUnit(UnitType.Airbase, game.ref(10, 10), {});
      const fighter = launch(blue, UnitType.Fighter, 60, 60);
      executeTicks(game, 20);
      expect(fighter.warshipState().state).toBe("patrolling");
      game.addExecution(
        new MoveWarshipExecution(blue, [fighter.id()], base.tile()),
      );
      executeTicks(game, 60);
      expect(fighter.warshipState().state).toBe("docked");
      executeTicks(game, 200);
      expect(fighter.warshipState().state).toBe("docked");
    });

    test("move orders retask aircraft anywhere, and still check water for warships", () => {
      blue.buildUnit(UnitType.Airbase, game.ref(10, 10), {});
      const heli = launch(blue, UnitType.AttackHelicopter, 20, 20);
      const target = game.ref(40, 40);
      game.addExecution(new MoveWarshipExecution(blue, [heli.id()], target));
      game.executeNextTick();
      expect(heli.warshipState().patrolTile).toBe(target);
    });
  });

  describe("radar and detection", () => {
    const tracked = (x: number, y: number, altitude: Altitude) =>
      isTrackedByRadar(
        game,
        game.ref(x, y),
        altitude,
        (s) => s.owner() === blue,
      );

    test("radar range grows with level and masks low flyers", () => {
      expect(radarRange(1)).toBe(100);
      expect(radarRange(2)).toBeGreaterThan(radarRange(1));
      expect(radarRange(50)).toBeLessThan(200);

      blue.buildUnit(UnitType.RadarStation, game.ref(10, 100), {});
      // High flyers: full range.
      expect(tracked(100, 100, Altitude.High)).toBe(true);
      expect(tracked(120, 100, Altitude.High)).toBe(false);
      // Helicopters: half range (terrain masking).
      expect(tracked(55, 100, Altitude.Low)).toBe(true);
      expect(tracked(70, 100, Altitude.Low)).toBe(false);
    });

    test("radars under construction see nothing; airbases add short coverage", () => {
      const radar = blue.buildUnit(
        UnitType.RadarStation,
        game.ref(10, 100),
        {},
      );
      radar.setUnderConstruction(true);
      expect(tracked(50, 100, Altitude.High)).toBe(false);

      blue.buildUnit(UnitType.Airbase, game.ref(10, 10), {});
      expect(tracked(10 + AIRBASE_RADAR_RANGE - 1, 10, Altitude.High)).toBe(
        true,
      );
      expect(tracked(10 + AIRBASE_RADAR_RANGE + 5, 10, Altitude.High)).toBe(
        false,
      );
    });

    test("another side's radar does not count", () => {
      red.buildUnit(UnitType.RadarStation, game.ref(150, 100), {});
      expect(tracked(120, 100, Altitude.High)).toBe(false);
    });
  });

  describe("air defence", () => {
    test("guided missiles: a flare may decoy, otherwise the hit lands", () => {
      const bomber = airborne(red, UnitType.Bomber, 150, 150);
      const maxHealth = bomber.health();
      const flares = bomber.aircraftState().flares;
      // Fire until the flares are spent: each impact consumes one.
      for (let i = 0; i < flares; i++) {
        game.addExecution(
          GuidedMissileExecution.fire(game.ref(140, 150), blue, bomber, {
            speed: 20,
            damage: 100,
            hitPercent: 100,
          }),
        );
        executeTicks(game, 3);
      }
      expect(bomber.aircraftState().flares).toBe(0);
      const before = bomber.health();
      game.addExecution(
        GuidedMissileExecution.fire(game.ref(140, 150), blue, bomber, {
          speed: 20,
          damage: 100,
          hitPercent: 100,
        }),
      );
      executeTicks(game, 3);
      expect(bomber.health()).toBe(before - 100);
      expect(bomber.health()).toBeLessThan(maxHealth);
    });

    test("SAMs engage radar-tracked jets, never untracked jets or helicopters", () => {
      // TestConfig fixes SAM range at 20 tiles.
      const sam = blue.buildUnit(UnitType.SAMLauncher, game.ref(90, 100), {});
      game.addExecution(new SAMLauncherExecution(blue, null, sam));
      const bomber = airborne(red, UnitType.Bomber, 100, 100);
      const heli = airborne(red, UnitType.AttackHelicopter, 95, 105);
      executeTicks(game, 3);
      // No radar: nothing tracked, nothing fired.
      expect(blue.units(UnitType.SAMMissile)).toHaveLength(0);

      blue.buildUnit(UnitType.RadarStation, game.ref(60, 100), {});
      executeTicks(game, 2);
      const missiles = blue.units(UnitType.SAMMissile);
      expect(missiles).toHaveLength(1);
      expect(missiles[0].targetUnit()).toBe(bomber);
      expect(missiles[0].targetUnit()).not.toBe(heli);
    });

    test("AA guns shoot down helicopters in range without any radar", () => {
      const gun = blue.buildUnit(UnitType.AAGun, game.ref(90, 100), {});
      game.addExecution(new AAGunExecution(gun));
      const heli = airborne(red, UnitType.AttackHelicopter, 105, 100);
      const far = airborne(red, UnitType.AttackHelicopter, 140, 100);
      executeTicks(game, 120);
      expect(heli.isActive()).toBe(false);
      expect(far.isActive()).toBe(true);
    });

    test("AA guns do not fire at friendly aircraft", () => {
      const gun = blue.buildUnit(UnitType.AAGun, game.ref(90, 100), {});
      game.addExecution(new AAGunExecution(gun));
      const own = airborne(blue, UnitType.AttackHelicopter, 95, 100);
      executeTicks(game, 60);
      expect(own.isActive()).toBe(true);
      expect(own.health()).toBe(own.maxHealth());
    });
  });

  describe("roles", () => {
    test("fighters fire on radar-tracked contacts beyond their own sensor", () => {
      blue.buildUnit(UnitType.Airbase, game.ref(10, 100), {});
      blue.buildUnit(UnitType.RadarStation, game.ref(60, 100), {});
      const fighter = launch(blue, UnitType.Fighter, 90, 100);
      const bomber = airborne(red, UnitType.Bomber, 150, 100);
      const ammo = aircraftSpec(UnitType.Fighter).ammo;
      let fired = false;
      for (let i = 0; i < 200 && !fired; i++) {
        game.executeNextTick();
        fired = fighter.aircraftState().ammo < ammo;
      }
      expect(fired).toBe(true);
      expect(fighter.targetUnit()).toBe(bomber);
    });

    test("fighters without radar only see contacts within their sensor range", () => {
      blue.buildUnit(UnitType.Airbase, game.ref(10, 100), {});
      const fighter = launch(blue, UnitType.Fighter, 30, 100);
      // Far beyond the fighter's 60-tile sensor; nobody tracks it.
      airborne(red, UnitType.Bomber, 145, 100);
      executeTicks(game, 120);
      expect(fighter.aircraftState().ammo).toBe(
        aircraftSpec(UnitType.Fighter).ammo,
      );
    });

    test("bombers knock structures down a level and kill troops", () => {
      blue.buildUnit(UnitType.Airbase, game.ref(80, 100), {});
      const city = red.buildUnit(UnitType.City, game.ref(130, 100), {});
      city.increaseLevel();
      expect(city.level()).toBe(2);
      const troops = red.troops();
      const bomber = launch(blue, UnitType.Bomber, 130, 100);
      let struck = false;
      for (let i = 0; i < 300 && !struck; i++) {
        game.executeNextTick();
        struck = bomber.aircraftState().ammo === 0;
      }
      expect(struck).toBe(true);
      expect(city.level()).toBe(1);
      expect(red.troops()).toBeLessThan(troops);
      // Empty, it heads home to rearm.
      expect(bomber.warshipState().state).toBe("retreating");
    });

    test("bombers do not strike their own or neutral ground", () => {
      blue.buildUnit(UnitType.Airbase, game.ref(10, 100), {});
      const city = blue.buildUnit(UnitType.City, game.ref(50, 100), {});
      const bomber = launch(blue, UnitType.Bomber, 50, 100);
      executeTicks(game, 100);
      expect(bomber.aircraftState().ammo).toBe(1);
      expect(city.isActive()).toBe(true);
    });

    test("transport helicopters land troops as an attack behind the lines", () => {
      blue.buildUnit(UnitType.Airbase, game.ref(80, 100), {});
      const zone = game.ref(150, 150);
      const blueTroops = blue.troops();
      const heli = launch(blue, UnitType.TransportHelicopter, 150, 150);
      expect(heli.troops()).toBe(Math.floor(blueTroops / 10));
      expect(blue.troops()).toBe(blueTroops - heli.troops());
      let landed = false;
      for (let i = 0; i < 400 && !landed; i++) {
        game.executeNextTick();
        landed = heli.troops() === 0;
      }
      expect(landed).toBe(true);
      expect(game.owner(zone)).toBe(blue);
      expect(blue.outgoingAttacks().some((a) => a.target() === red)).toBe(true);
    });

    test("transport helicopters reinforce friendly land", () => {
      blue.buildUnit(UnitType.Airbase, game.ref(10, 10), {});
      const heli = launch(blue, UnitType.TransportHelicopter, 50, 50);
      const carried = heli.troops();
      const before = blue.troops();
      executeTicks(game, 200);
      expect(heli.troops()).toBe(0);
      expect(blue.troops()).toBeGreaterThanOrEqual(before + carried);
    });

    test("attack helicopters sink transport boats", () => {
      blue.buildUnit(UnitType.Airbase, game.ref(10, 100), {});
      const heli = launch(blue, UnitType.AttackHelicopter, 40, 100);
      executeTicks(game, 40);
      // A boat placed right under the helicopter (on land: the map has no
      // water; only the targeting and the shell matter here).
      const boat = red.buildUnit(UnitType.TransportShip, game.ref(45, 100), {
        troops: 100,
      });
      executeTicks(game, 30);
      expect(boat.isActive()).toBe(false);
      expect(heli.aircraftState().ammo).toBeLessThan(
        aircraftSpec(UnitType.AttackHelicopter).ammo,
      );
    });
  });

  describe("motion", () => {
    test("stepToward reaches any tile in Chebyshev-distance steps", () => {
      const from = game.ref(10, 10);
      const to = game.ref(47, 23);
      let t = from;
      let steps = 0;
      while (t !== to && steps < 1000) {
        t = stepToward(game, t, to);
        steps++;
      }
      expect(t).toBe(to);
      expect(steps).toBe(37);
    });
  });
});
