import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { setup } from "../util/Setup";

// Regression test: the ghost/build-menu price of a structure must not double-count
// a player's first structure while it is still under construction.
//
// The cost scales as 2^(units built) * base: 1st city 125k, 2nd 250k, 3rd 500k.
// Cost uses Math.min(unitsOwned, unitsConstructed) so CAPTURED units (owned but
// not built) don't inflate the price. unitsConstructed used to also loop over
// under-construction units, double-counting them and defeating that Math.min —
// a captured city plus a first city under construction showed 500k (3rd-city
// price) instead of 250k.
describe("Structure cost while under construction", () => {
  let game: Game;
  let player: Player;
  let other: Player;

  const builderInfo = new PlayerInfo(
    "builder",
    PlayerType.Human,
    null,
    "builder_id",
  );
  const otherInfo = new PlayerInfo("other", PlayerType.Human, null, "other_id");

  beforeEach(async () => {
    game = await setup(
      "plains",
      { infiniteGold: false, instantBuild: false, infiniteTroops: true },
      [builderInfo, otherInfo],
    );
    player = game.player(builderInfo.id);
    other = game.player(otherInfo.id);
    player.conquer(game.ref(0, 10));
    other.conquer(game.ref(15, 15));
    player.addGold(100_000_000n);
    other.addGold(100_000_000n);
  });

  function buildFirstCityUnderConstruction() {
    game.addExecution(
      new ConstructionExecution(player, UnitType.City, game.ref(0, 10)),
    );
    game.executeNextTick(); // init
    game.executeNextTick(); // build unit + setUnderConstruction(true)
    const built = player
      .units(UnitType.City)
      .find((u) => u.tile() === game.ref(0, 10));
    expect(built?.isUnderConstruction()).toBe(true);
  }

  test("first city under construction does not double-count itself", () => {
    buildFirstCityUnderConstruction();
    // One built city (under construction) → next city is the 2nd → 250k.
    expect(player.unitsConstructed(UnitType.City)).toBe(1);
    expect(game.unitInfo(UnitType.City).cost(game, player)).toBe(250_000n);
  });

  test("captured city does not inflate the price of a city under construction", () => {
    // 'other' builds a city; 'player' captures it (owns it without building it).
    const captured = other.buildUnit(UnitType.City, game.ref(15, 15), {});
    player.captureUnit(captured);

    buildFirstCityUnderConstruction();

    // Player has BUILT exactly one city (still under construction). The captured
    // city must not count toward build cost, so the next city is still 250k.
    expect(player.unitsConstructed(UnitType.City)).toBe(1);
    expect(game.unitInfo(UnitType.City).cost(game, player)).toBe(250_000n);
  });
});
