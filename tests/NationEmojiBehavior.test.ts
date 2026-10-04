import {
  EMOJI_CLOWN,
  NationEmojiBehavior,
} from "../src/core/execution/nation/NationEmojiBehavior";
import { PlayerInfo, PlayerType } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

describe("Nation emojis", () => {
  it("only one nation mocks a traitor", async () => {
    const game = await setup("big_plains");
    const traitor = game.addPlayer(
      new PlayerInfo("traitor", PlayerType.Human, "c1", "traitor"),
    );
    const nations = Array.from({ length: 10 }, (_, i) =>
      game.addPlayer(
        new PlayerInfo(`nation${i}`, PlayerType.Nation, null, `nation${i}`),
      ),
    );
    const owners = [traitor, ...nations];
    const stripe = game.width() / owners.length;
    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;
      owners[Math.floor(game.x(tile) / stripe)].conquer(tile);
    });

    const behaviors = nations.map(
      (n, i) => new NationEmojiBehavior(new PseudoRandom(i), game, n),
    );
    const addExecSpy = vi.spyOn(game, "addExecution");

    traitor.markTraitor();
    for (let t = 0; t < game.config().traitorDuration(); t++) {
      behaviors.forEach((b) => b.maybeSendCasualEmoji());
      game.executeNextTick();
    }

    const clowns = addExecSpy.mock.calls.filter((c) => {
      const e = c[0] as any;
      return (
        e.constructor.name === "EmojiExecution" &&
        e.recipientID === traitor.id() &&
        EMOJI_CLOWN.includes(e.emoji)
      );
    });
    expect(clowns.length).toBeGreaterThan(0);
    expect(new Set(clowns.map((c) => (c[0] as any).requestor)).size).toBe(1);
  });
});
