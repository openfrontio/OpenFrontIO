import {
  AllPlayers,
  Difficulty,
  GameMode,
  PlayerInfo,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import { flattenedEmojiTable } from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { EmojiExecution } from "@openfront/engine/execution/EmojiExecution";
import {
  EMOJI_CLOWN,
  EMOJI_CONFUSED,
  EMOJI_CONGRATULATE,
  EMOJI_GOT_INSULTED,
  EMOJI_LOVE,
  EMOJI_VICTORY,
  NationEmojiBehavior,
} from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { MockInstance } from "vitest";
import { setup } from "./util/Setup";

type SentEmoji = { from: Player; to: string; emoji: number };

function sentEmojis(spy: MockInstance<Game["addExecution"]>): SentEmoji[] {
  return spy.mock.calls
    .map((c) => c[0])
    .filter((e): e is EmojiExecution => e instanceof EmojiExecution)
    .map((e) => ({
      from: e["requestor"],
      to: e["recipientID"],
      emoji: e["emoji"],
    }));
}

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

describe("Nation replies to emojis", () => {
  // A nation and a human on half the map each; the human sends the nation an emoji
  async function sendToNation(
    emoji: string,
    {
      difficulty = Difficulty.Medium,
      nationRelation = 0,
      humanRelation = 0,
    } = {},
  ) {
    const game = await setup("big_plains", { difficulty }, [
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
      new PlayerInfo("human", PlayerType.Human, "c1", "human"),
    ]);
    const nation = game.player("nation");
    const human = game.player("human");
    game.map().forEachTile((tile) => {
      (game.x(tile) < 100 ? nation : human).conquer(tile);
    });
    nation.updateRelation(human, nationRelation);
    human.updateRelation(nation, humanRelation);
    game.addExecution(
      new EmojiExecution(
        human,
        nation.id(),
        flattenedEmojiTable.indexOf(
          emoji as (typeof flattenedEmojiTable)[number],
        ),
      ),
    );
    const spy = vi.spyOn(game, "addExecution");
    // The first tick initializes the execution, the second sends the emoji
    game.executeNextTick();
    game.executeNextTick();
    const replies = sentEmojis(spy).filter((e) => e.from === nation);
    return { nation, human, replies };
  }

  it.each([
    ["🖕", "hostile", Relation.Hostile, EMOJI_GOT_INSULTED],
    ["🤡", "distrustful", Relation.Distrustful, EMOJI_CONFUSED],
    ["❤️", "neutral", Relation.Neutral, EMOJI_LOVE],
  ])(
    "after a %s the nation is %s and answers it",
    async (emoji, _, relation, answers) => {
      const { nation, human, replies } = await sendToNation(emoji);
      expect(nation.relation(human)).toBe(relation);
      expect(replies).toHaveLength(1);
      expect(replies[0].to).toBe(human.id());
      expect(answers).toContain(replies[0].emoji);
    },
  );

  it.each([
    [Difficulty.Easy, "friendly", Relation.Friendly],
    [Difficulty.Medium, "neutral", Relation.Neutral],
  ])(
    "%s: a heart leaves a nearly friendly nation %s",
    async (difficulty, _, relation) => {
      const { nation, human } = await sendToNation("❤️", {
        difficulty,
        nationRelation: 40,
      });
      expect(nation.relation(human)).toBe(relation);
    },
  );

  it("is confused by a heart from a human who distrusts it", async () => {
    const { replies } = await sendToNation("❤️", { humanRelation: -20 });
    expect(replies).toHaveLength(1);
    expect(EMOJI_CONFUSED).toContain(replies[0].emoji);
  });
});

describe("Nation emojis when the game ends", () => {
  it("in FFA only the largest nation congratulates a winning human, once", async () => {
    const game = await setup("big_plains", {}, [
      new PlayerInfo("big", PlayerType.Nation, null, "big"),
      new PlayerInfo("small", PlayerType.Nation, null, "small"),
      new PlayerInfo("winner", PlayerType.Human, "c1", "winner"),
    ]);
    game.map().forEachTile((tile) => {
      const x = game.x(tile);
      game.player(x < 60 ? "big" : x < 80 ? "small" : "winner").conquer(tile);
    });
    const nations = ["big", "small"].map((id) => game.player(id));
    const behaviors = nations.map(
      (n, i) => new NationEmojiBehavior(new PseudoRandom(i), game, n),
    );
    const spy = vi.spyOn(game, "addExecution");

    game.setWinner(game.player("winner"), {});
    for (let round = 0; round < 2; round++) {
      behaviors.forEach((b) => b.maybeSendCasualEmoji());
    }

    const congrats = sentEmojis(spy).filter((e) =>
      EMOJI_CONGRATULATE.includes(e.emoji),
    );
    expect(congrats).toEqual([
      { from: game.player("big"), to: "winner", emoji: EMOJI_CONGRATULATE[0] },
    ]);
  });

  it("in team games every nation congratulates the winning team", async () => {
    const info = (id: string, type: PlayerType, team: number) =>
      new PlayerInfo(id, type, null, id, false, null, [], team);
    const game = await setup(
      "big_plains",
      { gameMode: GameMode.Team, playerTeams: 2 },
      [
        info("n1", PlayerType.Nation, 0),
        info("n2", PlayerType.Nation, 0),
        info("winner", PlayerType.Human, 1),
      ],
    );
    const nations = ["n1", "n2"].map((id) => game.player(id));
    game.map().forEachTile((tile) => {
      const x = game.x(tile);
      (x < 50
        ? nations[0]
        : x < 100
          ? nations[1]
          : game.player("winner")
      ).conquer(tile);
    });
    const spy = vi.spyOn(game, "addExecution");

    game.setWinner(game.player("winner").team()!, {});
    nations.forEach((n, i) =>
      new NationEmojiBehavior(
        new PseudoRandom(i),
        game,
        n,
      ).maybeSendCasualEmoji(),
    );

    const congrats = sentEmojis(spy).filter((e) =>
      EMOJI_CONGRATULATE.includes(e.emoji),
    );
    expect(congrats.map((e) => [e.from, e.to])).toEqual([
      [nations[0], AllPlayers],
      [nations[1], AllPlayers],
    ]);
  });

  it.each([true, false])(
    "a winning nation celebrates on a coin flip (heads: %s)",
    async (heads) => {
      const game = await setup("big_plains", {}, [
        new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
      ]);
      const nation = game.player("nation");
      nation.conquer(game.ref(10, 10));
      const random = new PseudoRandom(1);
      // Only the celebration's coin flip; bragging would reuse some victory emojis
      vi.spyOn(random, "chance").mockImplementation((odds) =>
        odds === 2 ? heads : false,
      );
      const spy = vi.spyOn(game, "addExecution");

      game.setWinner(nation, {});
      new NationEmojiBehavior(random, game, nation).maybeSendCasualEmoji();

      const victory = sentEmojis(spy).filter((e) =>
        EMOJI_VICTORY.includes(e.emoji),
      );
      expect(victory.map((e) => e.to)).toEqual(heads ? [AllPlayers] : []);
    },
  );
});
