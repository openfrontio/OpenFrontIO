import { AllPlayers, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { Game, Player } from "@openfront/engine/game/Game";
import { playerInfo, setup } from "../../util/Setup";

describe("emoji rate limit", () => {
  let game: Game;
  let human: Player;
  let other: Player;
  let nation: Player;

  beforeEach(async () => {
    game = await setup("plains");
    human = game.addPlayer(playerInfo("human", PlayerType.Human));
    other = game.addPlayer(playerInfo("other", PlayerType.Human));
    nation = game.addPlayer(playerInfo("nation", PlayerType.Nation));
  });

  function sendUntilBlocked(
    from: Player,
    to: Player | typeof AllPlayers,
  ): number {
    let sent = 0;
    while (from.canSendEmoji(to) && sent < 100) {
      from.sendEmoji(to, "👍");
      sent++;
    }
    return sent;
  }

  it("lets a human send a batch of 5 to one recipient per window", () => {
    expect(sendUntilBlocked(human, other)).toBe(5);
    // Other recipients have their own allowance.
    expect(human.canSendEmoji(AllPlayers)).toBe(true);
    expect(human.canSendEmoji(nation)).toBe(true);
  });

  it("frees the allowance once the window passes", () => {
    sendUntilBlocked(human, other);
    for (let i = 0; i < game.config().emojiMessageWindow(); i++) {
      game.executeNextTick();
    }
    expect(sendUntilBlocked(human, other)).toBe(5);
  });

  it("keeps nations at one per window", () => {
    expect(sendUntilBlocked(nation, human)).toBe(1);
  });

  it("never lets a player emoji themself", () => {
    expect(human.canSendEmoji(human)).toBe(false);
  });
});
