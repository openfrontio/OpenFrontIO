import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
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

  test("the first constructed structure is free", () => {
    expect(game.unitInfo(UnitType.City).cost(game, player)).toBe(0n);
    player.buildUnit(UnitType.City, game.ref(0, 10), {});
    expect(game.unitInfo(UnitType.DefensePost).cost(game, player)).toBe(
      50_000n,
    );
  });

  test("losing every structure does not restore the free construction", () => {
    const city = player.buildUnit(UnitType.City, game.ref(0, 10), {});
    other.captureUnit(city);

    expect(player.units(Structures.types)).toHaveLength(0);
    expect(game.unitInfo(UnitType.DefensePost).cost(game, player)).toBe(
      50_000n,
    );
  });

  test("captured structure upgrades are paid and do not consume the entitlement", () => {
    const captured = other.buildUnit(UnitType.City, game.ref(15, 15), {});
    player.captureUnit(captured);
    const goldBefore = player.gold();

    player.upgradeUnit(captured);

    expect(player.gold()).toBe(goldBefore - 125_000n);
    expect(player.hasUsedFreeStructure()).toBe(false);
    expect(game.unitInfo(UnitType.DefensePost).cost(game, player)).toBe(0n);
  });

  test("tribe bots do not receive a free structure", async () => {
    const botInfo = new PlayerInfo("tribe", PlayerType.Bot, null, "tribe_id");
    const botGame = await setup("plains", {}, [botInfo]);
    const bot = botGame.player(botInfo.id);

    expect(botGame.unitInfo(UnitType.City).cost(botGame, bot)).toBe(125_000n);
  });

  test("AI nations receive their own one-time free structure", async () => {
    const nationInfo = new PlayerInfo(
      "nation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    const nationGame = await setup("plains", {}, [nationInfo]);
    const nation = nationGame.player(nationInfo.id);

    expect(nationGame.unitInfo(UnitType.Factory).cost(nationGame, nation)).toBe(
      0n,
    );
    nation.buildUnit(UnitType.Factory, nationGame.ref(0, 10), {});
    expect(nationGame.unitInfo(UnitType.City).cost(nationGame, nation)).toBe(
      125_000n,
    );
  });

  test("first city under construction does not double-count itself", () => {
    buildFirstCityUnderConstruction();
    // One built city (under construction) → next city is the 2nd → 250k.
    expect(player.unitsConstructed(UnitType.City)).toBe(1);
    expect(game.unitInfo(UnitType.City).cost(game, player)).toBe(250_000n);
  });

  test("research facilities use their own capped level-based cost curve", () => {
    player.buildUnit(UnitType.City, game.ref(0, 10), {});
    expect(game.unitInfo(UnitType.ResearchFacility).cost(game, player)).toBe(
      250_000n,
    );

    const facility = player.buildUnit(
      UnitType.ResearchFacility,
      game.ref(0, 10),
      {},
    );
    expect(game.unitInfo(UnitType.ResearchFacility).cost(game, player)).toBe(
      500_000n,
    );
    player.upgradeUnit(facility);
    expect(game.unitInfo(UnitType.ResearchFacility).cost(game, player)).toBe(
      1_000_000n,
    );
    player.upgradeUnit(facility);
    expect(game.unitInfo(UnitType.ResearchFacility).cost(game, player)).toBe(
      2_000_000n,
    );
    player.upgradeUnit(facility);
    expect(game.unitInfo(UnitType.ResearchFacility).cost(game, player)).toBe(
      2_000_000n,
    );
  });

  test("research facilities take five seconds to construct", () => {
    expect(game.unitInfo(UnitType.ResearchFacility).constructionDuration).toBe(
      50,
    );
  });

  test("SAM launcher cost caps at two million", () => {
    player.buildUnit(UnitType.City, game.ref(0, 10), {});
    expect(game.unitInfo(UnitType.SAMLauncher).cost(game, player)).toBe(
      1_500_000n,
    );
    player.buildUnit(UnitType.SAMLauncher, game.ref(0, 10), {});
    expect(game.unitInfo(UnitType.SAMLauncher).cost(game, player)).toBe(
      2_000_000n,
    );
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
