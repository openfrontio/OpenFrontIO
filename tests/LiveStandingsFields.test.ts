import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

// OFM live standings: killedBy + deathPosition are stored on the player's stats
// (mg.stats()) and surfaced on the live PlayerUpdate every tick, so the admin
// bot can score placement + kills off the live snapshot instead of waiting for
// the post-game record.
describe("OFM live standings fields", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup("ocean_and_land");
  });

  function addHuman(id: string, clientID: string | null) {
    game.addPlayer(new PlayerInfo(id, PlayerType.Human, clientID, id));
    return game.player(id);
  }

  test("conquest stamps killedBy + deathPosition into stats", () => {
    const conqueror = addHuman("conqueror", "conqueror_client");
    const victim = addHuman("victim", "victim_client");

    game.conquerPlayer(conqueror, victim);

    const stats = game.stats().getPlayerStats(victim);
    expect(stats?.killedBy).toBe("conqueror_client");
    expect(typeof stats?.deathPosition).toBe("number");
  });

  test("stamped fields ride the live PlayerUpdate", () => {
    const conqueror = addHuman("conqueror", "conqueror_client");
    const victim = addHuman("victim", "victim_client");

    game.conquerPlayer(conqueror, victim);

    const update = victim.toUpdate();
    expect(update?.killedBy).toBe("conqueror_client");
    expect(typeof update?.deathPosition).toBe("number");
  });

  test("a non-client killer records killedBy as null (not unstamped)", () => {
    // A conqueror with no clientID (e.g. a bot/nation): killedBy is a recorded
    // null, distinct from the alive/unstamped case (also null, see below).
    game.addPlayer(
      new PlayerInfo("botkiller", PlayerType.Bot, null, "botkiller"),
    );
    const killer = game.player("botkiller");
    const victim = addHuman("victim2", "victim2_client");

    game.conquerPlayer(killer, victim);

    const update = victim.toUpdate();
    expect(update?.killedBy).toBeNull();
    expect(typeof update?.deathPosition).toBe("number");
  });

  test("an alive player has null killedBy + deathPosition on its update", () => {
    const alive = addHuman("alive", "alive_client");
    const update = alive.toUpdate();
    expect(update?.killedBy).toBeNull();
    expect(update?.deathPosition).toBeNull();
  });
});
