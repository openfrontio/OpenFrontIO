import {
  PlayerInfo,
  PlayerType,
  TrainType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TANK } from "@openfront/engine-lib/game/ModRules";
import { AirportExecution } from "@openfront/engine/execution/AirportExecution";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { CargoPlaneExecution } from "@openfront/engine/execution/CargoPlaneExecution";
import { FighterJetExecution } from "@openfront/engine/execution/FighterJetExecution";
import { MoveWarshipExecution } from "@openfront/engine/execution/MoveWarshipExecution";
import { TankExecution } from "@openfront/engine/execution/TankExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { constructionExecution, executeTicks } from "./util/utils";

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

describe("Mod units on land and in the air", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true }, [
      new PlayerInfo("one", PlayerType.Human, null, "p1"),
      new PlayerInfo("two", PlayerType.Human, null, "p2"),
    ]);
    p1 = game.player("p1");
    p2 = game.player("p2");
    executeTicks(game, 5);
  });

  describe("Tank", () => {
    test("is built at a factory and only where a factory exists", () => {
      claim(p1, 10, 10, 20, 20);
      expect(p1.canBuild(UnitType.Tank, game.ref(15, 15))).toBe(false);
      p1.buildUnit(UnitType.Factory, game.ref(12, 12), {});
      expect(p1.canBuild(UnitType.Tank, game.ref(15, 15))).toBe(
        game.ref(12, 12),
      );
    });

    test("constructs through the build pipeline and runs", () => {
      claim(p1, 10, 10, 20, 20);
      p1.buildUnit(UnitType.Factory, game.ref(12, 12), {});
      constructionExecution(game, p1, 20, 20, UnitType.Tank);
      expect(p1.units(UnitType.Tank)).toHaveLength(1);
    });

    test("follows a move order and parks at the new spot", () => {
      claim(p1, 10, 10, 40, 20);
      const tank = p1.buildUnit(UnitType.Tank, game.ref(15, 20), {
        patrolTile: game.ref(15, 20),
      });
      game.addExecution(new TankExecution(tank));
      // 14 tiles away: well inside the old 40-tile "drifted too far" radius.
      game.addExecution(
        new MoveWarshipExecution(p1, [tank.id()], game.ref(29, 20)),
      );
      executeTicks(game, 120);
      expect(
        game.euclideanDistSquared(tank.tile(), game.ref(29, 20)),
      ).toBeLessThanOrEqual(TANK.holdRadius * TANK.holdRadius);
    });

    test("steals an enemy train together with its cars", () => {
      claim(p1, 10, 10, 20, 20);
      claim(p2, 40, 10, 20, 20);
      const tank = p1.buildUnit(UnitType.Tank, game.ref(20, 20), {
        patrolTile: game.ref(20, 20),
      });
      game.addExecution(new TankExecution(tank));
      const engine = p2.buildUnit(UnitType.Train, game.ref(23, 20), {
        trainType: TrainType.Engine,
      });
      const car = p2.buildUnit(UnitType.Train, game.ref(25, 20), {
        trainType: TrainType.Carriage,
      });
      const farCar = p2.buildUnit(UnitType.Train, game.ref(55, 20), {
        trainType: TrainType.Carriage,
      });
      executeTicks(game, 40);
      expect(engine.owner()).toBe(p1);
      expect(car.owner()).toBe(p1);
      // A car that is not trailing the engine stays with its owner.
      expect(farCar.owner()).toBe(p2);
    });

    test("does not steal a friend's train", () => {
      claim(p1, 10, 10, 20, 20);
      const tank = p1.buildUnit(UnitType.Tank, game.ref(20, 20), {
        patrolTile: game.ref(20, 20),
      });
      game.addExecution(new TankExecution(tank));
      const alliance = game.player("p2");
      claim(p2, 40, 10, 5, 5);
      p1.createAllianceRequest(alliance)?.accept();
      const train = p2.buildUnit(UnitType.Train, game.ref(22, 20), {
        trainType: TrainType.Engine,
      });
      executeTicks(game, 40);
      expect(train.owner()).toBe(p2);
    });

    test("tanks fight each other", () => {
      claim(p1, 10, 10, 20, 20);
      claim(p2, 40, 10, 20, 20);
      const t1 = p1.buildUnit(UnitType.Tank, game.ref(30, 20), {
        patrolTile: game.ref(30, 20),
      });
      const t2 = p2.buildUnit(UnitType.Tank, game.ref(38, 20), {
        patrolTile: game.ref(38, 20),
      });
      game.addExecution(new TankExecution(t1), new TankExecution(t2));
      executeTicks(game, TANK.shotInterval * 2 + 5);
      expect(t1.health()).toBeLessThan(t1.maxHealth());
      expect(t2.health()).toBeLessThan(t2.maxHealth());
    });

    test("kills troops of an attack on its owner's land", () => {
      claim(p1, 10, 10, 20, 20);
      claim(p2, 30, 10, 20, 20);
      p1.addTroops(100_000);
      p2.addTroops(100_000);
      const tank = p1.buildUnit(UnitType.Tank, game.ref(28, 20), {
        patrolTile: game.ref(28, 20),
      });
      game.addExecution(new TankExecution(tank));
      game.addExecution(new AttackExecution(50_000, p2, p1.id()));
      executeTicks(game, 3);
      const attack = p1.incomingAttacks()[0];
      expect(attack).toBeDefined();
      const before = attack.troops();
      executeTicks(game, TANK.shotInterval + 2);
      // Troops only fall; the tank kills some on top of normal combat losses.
      expect(attack.troops()).toBeLessThan(
        before - TANK.troopsKilledPerShot / 2,
      );
    });
  });

  describe("Airport and cargo planes", () => {
    test("both airports are paid when a plane lands", () => {
      claim(p1, 10, 10, 10, 10);
      claim(p2, 70, 10, 10, 10);
      const a1 = p1.buildUnit(UnitType.Airport, game.ref(12, 12), {});
      const a2 = p2.buildUnit(UnitType.Airport, game.ref(72, 12), {});
      const g1 = p1.gold();
      const g2 = p2.gold();
      game.addExecution(new CargoPlaneExecution(p1, a1, a2));
      executeTicks(game, 80);
      expect(p1.units(UnitType.CargoPlane)).toHaveLength(0);
      expect(p1.gold()).toBeGreaterThan(g1);
      expect(p2.gold()).toBeGreaterThan(g2);
    });

    test("an airport sends planes to other players' airports over time", () => {
      claim(p1, 10, 10, 10, 10);
      claim(p2, 70, 10, 10, 10);
      const a1 = p1.buildUnit(UnitType.Airport, game.ref(12, 12), {});
      p2.buildUnit(UnitType.Airport, game.ref(72, 12), {});
      game.addExecution(new AirportExecution(a1));
      let sawPlane = false;
      for (let i = 0; i < 1500 && !sawPlane; i++) {
        game.executeNextTick();
        sawPlane = game.unitCount(UnitType.CargoPlane) > 0;
      }
      expect(sawPlane).toBe(true);
    });

    test("a fighter jet steals a cargo plane, which then pays the thief", () => {
      claim(p1, 10, 10, 10, 10);
      claim(p2, 70, 10, 10, 10);
      const a1 = p1.buildUnit(UnitType.Airport, game.ref(12, 12), {});
      const a2 = p2.buildUnit(UnitType.Airport, game.ref(72, 12), {});
      const thiefAirport = p2.buildUnit(UnitType.Airport, game.ref(75, 15), {});
      expect(thiefAirport.isActive()).toBe(true);
      game.addExecution(new CargoPlaneExecution(p1, a1, a2));
      const jet = p2.buildUnit(UnitType.FighterJet, game.ref(40, 12), {
        patrolTile: game.ref(40, 12),
      });
      game.addExecution(new FighterJetExecution(jet));
      executeTicks(game, 25);
      const planes = game.units(UnitType.CargoPlane);
      expect(planes.length).toBeGreaterThan(0);
      expect(planes[0].owner()).toBe(p2);
    });

    test("fighter jets shoot enemy jets and tanks", () => {
      claim(p1, 10, 10, 20, 20);
      claim(p2, 40, 10, 20, 20);
      const tank = p1.buildUnit(UnitType.Tank, game.ref(20, 20), {
        patrolTile: game.ref(20, 20),
      });
      const jet = p2.buildUnit(UnitType.FighterJet, game.ref(30, 20), {
        patrolTile: game.ref(30, 20),
      });
      game.addExecution(new FighterJetExecution(jet));
      executeTicks(game, 60);
      expect(tank.health()).toBeLessThan(tank.maxHealth());
    });
  });
});
