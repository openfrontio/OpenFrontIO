import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { simpleHash } from "../../../src/core/Util";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

let game: Game;
let player: Player;
let otherPlayer: Player;

describe("PlayerExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id"),
        new PlayerInfo("other", PlayerType.Human, "client_id2", "other_id"),
      ],
    );

    player = game.player("player_id");
    otherPlayer = game.player("other_id");

    game.addExecution(new PlayerExecution(player));
    game.addExecution(new PlayerExecution(otherPlayer));
  });

  test("DefensePost lv. 1 is destroyed when tile owner changes", () => {
    const tile = game.ref(50, 50);
    player.conquer(tile);
    const defensePost = player.buildUnit(UnitType.DefensePost, tile, {});

    game.executeNextTick();
    expect(game.unitCount(UnitType.DefensePost)).toBe(1);
    expect(defensePost.level()).toBe(1);

    otherPlayer.conquer(tile);
    executeTicks(game, 2);

    expect(game.unitCount(UnitType.DefensePost)).toBe(0);
  });

  test("DefensePost lv. 2+ is destroyed when tile owner changes", () => {
    const tile = game.ref(50, 50);
    player.conquer(tile);
    const defensePost = player.buildUnit(UnitType.DefensePost, tile, {});
    defensePost.increaseLevel();

    expect(defensePost.level()).toBe(2);
    expect(game.unitCount(UnitType.DefensePost)).toBe(2); // unitCount sums levels
    expect(player.units(UnitType.DefensePost)).toHaveLength(1);
    expect(defensePost.isActive()).toBe(true);

    otherPlayer.conquer(tile);
    executeTicks(game, 2);

    expect(game.unitCount(UnitType.DefensePost)).toBe(0);
    expect(defensePost.isActive()).toBe(false);
  });

  test("Non-DefensePost structures are transferred (not downgraded) when tile owner changes", () => {
    const tile = game.ref(50, 50);
    player.conquer(tile);
    const city = player.buildUnit(UnitType.City, tile, {});

    expect(game.unitCount(UnitType.City)).toBe(1);
    expect(city.level()).toBe(1);
    expect(city.owner()).toBe(player);
    expect(city.isActive()).toBe(true);

    otherPlayer.conquer(tile);
    executeTicks(game, 2);

    expect(game.unitCount(UnitType.City)).toBe(1);
    expect(city.level()).toBe(1);
    expect(city.owner()).toBe(otherPlayer);
    expect(city.isActive()).toBe(true);
  });
});

// Regression guard for the anonymize-names desync: the cluster-removal schedule
// must be seeded from a value that is identical on every client. The
// anonymize-names option sends each client a different username for the same
// player, so seeding from name() staggered removeClusters() onto different
// ticks per client and desynced tile ownership. id() is client-identical.
describe("PlayerExecution cluster-recalc determinism", () => {
  test("phase offset is seeded from id(), not the (per-client) username", async () => {
    const STABLE_ID = "stable-player-id";

    // Two clients that disagree on the username but agree on id() — exactly what
    // anonymize-names produces for the same logical player.
    const gameA = await setup("big_plains", {}, [
      new PlayerInfo("Alice", PlayerType.Human, "client_a", STABLE_ID),
    ]);
    const execA = new PlayerExecution(gameA.player(STABLE_ID));
    execA.init(gameA, 0);

    const gameB = await setup("big_plains", {}, [
      new PlayerInfo("Crimson Tiger", PlayerType.Human, "client_a", STABLE_ID),
    ]);
    const execB = new PlayerExecution(gameB.player(STABLE_ID));
    execB.init(gameB, 0);

    // Same id => same schedule, regardless of the differing usernames.
    expect((execA as any).lastCalc).toBe((execB as any).lastCalc);
    // And it is the id-derived offset (ticksPerClusterCalc = 20).
    expect((execA as any).lastCalc).toBe(simpleHash(STABLE_ID) % 20);
  });
});
