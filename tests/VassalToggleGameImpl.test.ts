import { Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

describe("Vassalize with vassals disabled", () => {
  let game: Game;
  let p1: Player;
  let p2: Player;

  beforeEach(async () => {
    game = await setup(
      "plains",
      { enableVassals: false },
      [playerInfo("p1", PlayerType.Human), playerInfo("p2", PlayerType.Human)],
    );
    p1 = game.player("p1");
    p2 = game.player("p2");
  });

  it("returns null and makes no vassalage", () => {
    const result = game.vassalize(p2, p1);
    expect(result).toBeNull();
    expect(game.vassalages().length).toBe(0);
    expect(p2.overlord()).toBeNull();
  });
});

describe("Vassalize with vassals enabled", () => {
  let game: Game;
  let p1: Player;
  let p2: Player;

  beforeEach(async () => {
    game = await setup(
      "plains",
      { enableVassals: true },
      [playerInfo("p1", PlayerType.Human), playerInfo("p2", PlayerType.Human)],
    );
    p1 = game.player("p1");
    p2 = game.player("p2");
  });

  it("creates vassalage", () => {
    const result = game.vassalize(p2, p1);
    expect(result).not.toBeNull();
    expect(game.vassalages().length).toBe(1);
    expect(p2.overlord()).toBe(p1);
  });
});
