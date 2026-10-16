import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { Game, Player } from "@openfront/engine/game/Game";
import { PlayerImpl } from "@openfront/engine/game/PlayerImpl";
import { setup } from "./util/Setup";

let game: Game;
let player: PlayerImpl;
let other: Player;

describe("PlayerImpl", () => {
  beforeEach(async () => {
    game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("player", PlayerType.Human, null, "player_id"),
      new PlayerInfo("other", PlayerType.Human, null, "other_id"),
    ]);

    player = game.player("player_id") as PlayerImpl;
    other = game.player("other_id");

    player.conquer(game.ref(0, 0));
    other.conquer(game.ref(50, 50));
    player.addGold(BigInt(1000000));

    game.config().structureMinDist = () => 10;
  });

  test("City can be upgraded", () => {
    const city = player.buildUnit(UnitType.City, game.ref(0, 0), {});
    const buCity = player
      .buildableUnits(game.ref(0, 0))
      .find((bu) => bu.type === UnitType.City);
    expect(buCity).toBeDefined();
    expect(buCity!.canUpgrade).toBe(city.id());
  });

  test("DefensePost cannot be upgraded", () => {
    player.buildUnit(UnitType.DefensePost, game.ref(0, 0), {});
    const buDefensePost = player
      .buildableUnits(game.ref(0, 0))
      .find((bu) => bu.type === UnitType.DefensePost);
    expect(buDefensePost).toBeDefined();
    expect(buDefensePost!.canUpgrade).toBeFalsy();
  });

  test("City can be upgraded from another city", () => {
    const city = player.buildUnit(UnitType.City, game.ref(0, 0), {});
    const cityToUpgrade = player.findUnitToUpgrade(
      UnitType.City,
      game.ref(0, 1),
    );
    expect(cityToUpgrade).toBeTruthy();
    if (cityToUpgrade === false) {
      return;
    }
    expect(cityToUpgrade.id()).toBe(city.id());
  });
  test("City cannot be upgraded when too far away", () => {
    player.buildUnit(UnitType.City, game.ref(0, 0), {});
    const cityToUpgrade = player.findUnitToUpgrade(
      UnitType.City,
      game.ref(50, 50),
    );
    expect(cityToUpgrade).toBe(false);
  });
  test("Unit cannot be upgraded when not enough gold", () => {
    player.buildUnit(UnitType.City, game.ref(0, 0), {});
    player.removeGold(BigInt(1000000));
    const cityToUpgrade = player.findUnitToUpgrade(
      UnitType.City,
      game.ref(0, 1),
    );
    expect(cityToUpgrade).toBe(false);
  });

  describe("units() type filtering", () => {
    beforeEach(() => {
      player.buildUnit(UnitType.City, game.ref(0, 0), {});
      player.buildUnit(UnitType.DefensePost, game.ref(11, 0), {});
      player.buildUnit(UnitType.City, game.ref(0, 11), {});
      player.buildUnit(UnitType.MissileSilo, game.ref(11, 11), {});
    });

    // Reference implementation: filter _units preserving insertion order.
    function expected(...types: UnitType[]) {
      const ts = new Set(types);
      return player.units().filter((u) => ts.has(u.type()));
    }

    test("single type returns matching units in insertion order", () => {
      expect(player.units(UnitType.City)).toEqual(expected(UnitType.City));
      expect(player.units(UnitType.City)).toHaveLength(2);
    });

    test("returns a fresh array, not the internal or shared buffer", () => {
      const a = player.units(UnitType.City);
      const b = player.units(UnitType.City);
      expect(a).not.toBe(b);
      expect(a).not.toBe(player.units());
      // Mutating one result must not affect a later query.
      a.length = 0;
      expect(player.units(UnitType.City)).toHaveLength(2);
    });

    test("two and three types return the union in insertion order", () => {
      expect(player.units(UnitType.City, UnitType.MissileSilo)).toEqual(
        expected(UnitType.City, UnitType.MissileSilo),
      );
      expect(
        player.units(UnitType.City, UnitType.DefensePost, UnitType.MissileSilo),
      ).toEqual(
        expected(UnitType.City, UnitType.DefensePost, UnitType.MissileSilo),
      );
      // Duplicate types don't duplicate results.
      expect(player.units(UnitType.City, UnitType.City)).toEqual(
        expected(UnitType.City),
      );
    });

    test("array of types (Set path) and no match", () => {
      expect(
        player.units([
          UnitType.City,
          UnitType.DefensePost,
          UnitType.MissileSilo,
          UnitType.Port,
        ]),
      ).toEqual(
        expected(UnitType.City, UnitType.DefensePost, UnitType.MissileSilo),
      );
      expect(player.units(UnitType.Port)).toEqual([]);
    });
  });

  test("Can't send alliance requests when dead", () => {
    // conquer other
    const otherTiles = other.tiles();
    for (const tile of otherTiles) {
      player.conquer(tile);
    }
    expect(other.canSendAllianceRequest(player)).toBe(false);
  });

  describe("tiles()", () => {
    test("returns a live view that reflects later ownership changes", () => {
      const tiles = player.tiles();
      const sizeBefore = tiles.size;
      const tile = game.ref(5, 5);
      player.conquer(tile);
      expect(tiles.has(tile)).toBe(true);
      expect(tiles.size).toBe(sizeBefore + 1);
    });

    test("every tile is visited when relinquishing during iteration", () => {
      player.conquer(game.ref(1, 0));
      player.conquer(game.ref(2, 0));
      const owned = player.numTilesOwned();
      expect(owned).toBeGreaterThan(1);
      // SpawnExecution relinquishes all tiles while iterating tiles().
      let visited = 0;
      player.tiles().forEach((t) => {
        visited++;
        player.relinquish(t);
      });
      expect(visited).toBe(owned);
      expect(player.numTilesOwned()).toBe(0);
    });
  });

  describe("portSpawn", () => {
    test("returns false when candidate has no valid shore tiles", () => {
      // (0, 0) is owned, but not shore
      expect(game.isShore(game.ref(0, 0))).toBe(false);
      expect(player.portSpawn(game.ref(0, 0), null)).toBe(false);
    });

    test("returns shore tile when available within valid structure spawn tiles", () => {
      const tile = game.ref(0, 0);
      game.map().setShorelineBit(tile);
      expect(game.isShore(tile)).toBe(true);
      expect(player.portSpawn(tile, null)).toBe(tile);
    });

    test("scans validTiles array directly and picks first shore tile", () => {
      const t1 = game.ref(0, 1);
      const t2 = game.ref(1, 0);
      game.map().setShorelineBit(t2);

      expect(player.portSpawn(game.ref(0, 0), [t1, t2])).toBe(t2);
    });

    test("returns false when candidate shore tile is blocked by nearby structure", () => {
      const tile = game.ref(0, 0);
      game.map().setShorelineBit(tile);
      player.buildUnit(UnitType.DefensePost, tile, {});
      expect(player.portSpawn(tile, null)).toBe(false);
    });
  });

  describe("canAttack", () => {
    test("returns true for unowned land directly adjacent to player territory", () => {
      // player owns (0, 0). (0, 1) is unowned land adjacent to (0, 0).
      const adjacentNeutral = game.ref(0, 1);
      expect(game.hasOwner(adjacentNeutral)).toBe(false);
      expect(player.canAttack(adjacentNeutral)).toBe(true);
    });

    test("returns false for unowned tile unreachable from player border", () => {
      const isolated = game.ref(5, 5);
      expect(game.hasOwner(isolated)).toBe(false);
      // Surround isolated tile with water so no neutral land path can reach player
      game.forEachNeighbor(isolated, (n) => game.map().setWater(n));
      expect(player.canAttack(isolated)).toBe(false);
    });

    test("returns false when targeting own tile", () => {
      expect(player.canAttack(game.ref(0, 0))).toBe(false);
    });
  });
});
