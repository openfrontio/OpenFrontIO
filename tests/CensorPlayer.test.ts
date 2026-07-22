import { CensorPlayerExecution } from "../src/core/execution/CensorPlayerExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let player: Player;
let clanPlayer: Player;

describe("CensorPlayerExecution", () => {
  beforeEach(async () => {
    const playerInfo = new PlayerInfo(
      "BadName",
      PlayerType.Human,
      "client1",
      "player1_id",
    );
    const clanPlayerInfo = new PlayerInfo(
      "OtherName",
      PlayerType.Human,
      "client2",
      "player2_id",
      false,
      "CLAN",
    );

    game = await setup("plains", {}, [playerInfo, clanPlayerInfo]);
    player = game.player(playerInfo.id);
    clanPlayer = game.player(clanPlayerInfo.id);
  });

  test("replaces name and displayName", () => {
    game.addExecution(new CensorPlayerExecution(player, "ShadowName"));
    executeTicks(game, 1);

    expect(player.name()).toBe("ShadowName");
    expect(player.displayName()).toBe("ShadowName");
  });

  test("keeps the clan tag in displayName", () => {
    game.addExecution(new CensorPlayerExecution(clanPlayer, "ShadowName"));
    executeTicks(game, 1);

    expect(clanPlayer.name()).toBe("ShadowName");
    expect(clanPlayer.displayName()).toBe("[CLAN] ShadowName");
  });

  test("a later execution restores the original name (verdicts can flip)", () => {
    game.addExecution(new CensorPlayerExecution(player, "ShadowName"));
    executeTicks(game, 1);
    game.addExecution(new CensorPlayerExecution(player, "BadName"));
    executeTicks(game, 1);

    expect(player.name()).toBe("BadName");
    expect(player.displayName()).toBe("BadName");
  });

  test("is active during spawn phase", () => {
    const execution = new CensorPlayerExecution(player, "ShadowName");
    expect(execution.activeDuringSpawnPhase()).toBe(true);
  });

  test("rename is carried in the next player update diff", () => {
    // First update is the full snapshot; rename directly since
    // executeNextTick would consume the diff itself.
    player.toUpdate();
    player.rename("ShadowName");

    const update = player.toUpdate();
    expect(update?.name).toBe("ShadowName");
    expect(update?.displayName).toBe("ShadowName");
  });

  test("does not change the deterministic player hash", () => {
    // The game sync hash sums player hashes (GameImpl.hash), so a rename must
    // leave the player hash untouched or every client would flag a desync.
    const before = (player as any).hash();
    game.addExecution(new CensorPlayerExecution(player, "ShadowName"));
    executeTicks(game, 1);
    const after = (player as any).hash();

    expect(after).toBe(before);
  });
});
