import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import {
  candidateShoreTiles,
  closestShoreFromPlayer,
} from "../../../src/core/game/TransportShipUtils";
import { setup } from "../../util/Setup";

let game: Game;
let player: Player;

describe("TransportShipUtils", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", {});
    const info = new PlayerInfo("test", PlayerType.Human, null, "p1");
    game.addPlayer(info);
    player = game.player("p1");

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  test("closestShoreFromPlayer picks the physically closest tile", () => {
    const tileClose = game.ref(7, 5);
    const tileFar = game.ref(7, 10);

    player.conquer(tileClose);
    player.conquer(tileFar);

    const target = game.ref(12, 5);

    const result = closestShoreFromPlayer(game.map(), player, target);
    expect(result).toBe(tileClose);
  });

  test("returns null/empty if player is landlocked", () => {
    player.conquer(game.ref(0, 0));
    player.conquer(game.ref(1, 1));

    const target = game.ref(15, 15);

    expect(closestShoreFromPlayer(game.map(), player, target)).toBeNull();
    expect(candidateShoreTiles(game, player, target)).toEqual([]);
  });

  test("candidateShoreTiles includes extremums (Min/Max X/Y)", () => {
    // Own the entire vertical coast line (x=7, y=0 to 15)
    for (let y = 0; y < 16; y++) {
      player.conquer(game.ref(7, y));
    }

    const target = game.ref(15, 8);
    const result = candidateShoreTiles(game, player, target);

    expect(result).toContain(game.ref(7, 8)); // Closest
    expect(result).toContain(game.ref(7, 0)); // Min Y
    expect(result).toContain(game.ref(7, 15)); // Max Y
  });

  test("deterministically breaks ties when distances are equal", () => {
    // p1 and p2 are equidistant from target (8, 5)
    const p1 = game.ref(7, 4);
    const p2 = game.ref(7, 6);
    const target = game.ref(8, 5);

    player.conquer(p1);
    player.conquer(p2);

    const result = closestShoreFromPlayer(game.map(), player, target);

    // Logic prefers higher ID when distances are equal to ensure determinism
    const expected = p1 > p2 ? p1 : p2;
    expect(result).toBe(expected);
  });
});
