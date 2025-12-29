import { VassalOfferExecution } from "../src/core/execution/VassalOfferExecution";
import { VassalOfferReplyExecution } from "../src/core/execution/VassalOfferReplyExecution";
import { SurrenderExecution } from "../src/core/execution/SurrenderExecution";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

describe("Vassal features disabled", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;

  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        enableVassals: false,
        infiniteGold: true,
        infiniteTroops: true,
        instantBuild: true,
      },
      [
        playerInfo("player1", PlayerType.Human),
        playerInfo("player2", PlayerType.Human),
      ],
    );

    player1 = game.player("player1");
    player2 = game.player("player2");

    player1.conquer(game.ref(0, 0));
    player2.conquer(game.ref(0, 1));

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  test("surrender execution is ignored when vassals disabled", () => {
    game.addExecution(new SurrenderExecution(player1, player2.id()));
    game.executeNextTick();

    expect(game.vassalages().length).toBe(0);
    expect(player1.overlord()).toBeNull();
  });

  test("vassal offer execution is ignored when vassals disabled", () => {
    game.addExecution(new VassalOfferExecution(player1, player2.id()));
    game.executeNextTick();

    expect(game.vassalages().length).toBe(0);
    expect(player2.overlord()).toBeNull();
  });
});

describe("Vassal features enabled", () => {
  let game: Game;
  let player1: Player;
  let player2: Player;

  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        enableVassals: true,
        infiniteGold: true,
        infiniteTroops: true,
        instantBuild: true,
      },
      [
        playerInfo("player1", PlayerType.Human),
        playerInfo("player2", PlayerType.Human),
      ],
    );

    player1 = game.player("player1");
    player2 = game.player("player2");

    player1.conquer(game.ref(0, 0));
    player2.conquer(game.ref(0, 1));

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    jest.spyOn(player1, "troops").mockReturnValue(1000);
    jest.spyOn(player2, "troops").mockReturnValue(100);
    jest.spyOn(player1, "numTilesOwned").mockReturnValue(4);
    jest.spyOn(player2, "numTilesOwned").mockReturnValue(1);
    jest.spyOn(player2, "borderTiles").mockReturnValue(new Set<number>());
  });

  test("surrender execution applies when enabled", () => {
    game.addExecution(new SurrenderExecution(player1, player2.id()));
    game.executeNextTick();
    game.executeNextTick(); // allow execution to process after init (request sent)

    // Simulate recipient accepting the surrender
    const accept = new VassalOfferReplyExecution(player2.id(), player1.id(), true);
    accept.init(game as any);
    accept.tick();

    expect(game.vassalages().length).toBe(1);
    expect(player1.overlord()).toBe(player2);
  });

  test("vassal offer execution auto-applies for bots when enabled", async () => {
    // Replace player2 with a bot for this check
    const botGame = await setup(
      "plains",
      {
        enableVassals: true,
        infiniteGold: true,
        infiniteTroops: true,
        instantBuild: true,
      },
      [playerInfo("player1", PlayerType.Human), playerInfo("bot", PlayerType.Bot)],
    );
    const botOverlord = botGame.player("player1");
    const botTarget = botGame.player("bot");
    botOverlord.conquer(botGame.ref(0, 0));
    botTarget.conquer(botGame.ref(0, 1));
    while (botGame.inSpawnPhase()) {
      botGame.executeNextTick();
    }
    jest.spyOn(botOverlord, "troops").mockReturnValue(1000);
    jest.spyOn(botTarget, "troops").mockReturnValue(100);
    jest.spyOn(botOverlord, "numTilesOwned").mockReturnValue(4);
    jest.spyOn(botTarget, "numTilesOwned").mockReturnValue(1);
    jest.spyOn(botTarget, "incomingAttacks").mockReturnValue([
      { attacker: () => botOverlord, target: () => botTarget } as any,
    ]);
    jest.spyOn(botTarget, "outgoingAttacks").mockReturnValue([]);
    jest.spyOn(botTarget, "borderTiles").mockReturnValue(new Set<number>());

    botGame.addExecution(new VassalOfferExecution(botOverlord, botTarget.id()));
    botGame.executeNextTick();
    botGame.executeNextTick(); // allow execution to process after init

    expect(botGame.vassalages().length).toBe(1);
    expect(botTarget.overlord()).toBe(botOverlord);
  });

  test("bot does not auto-accept when stronger", async () => {
    const botGame = await setup(
      "plains",
      {
        enableVassals: true,
        infiniteGold: true,
        infiniteTroops: true,
        instantBuild: true,
      },
      [playerInfo("player1", PlayerType.Human), playerInfo("bot", PlayerType.Bot)],
    );
    const botOverlord = botGame.player("player1");
    const botTarget = botGame.player("bot");
    botOverlord.conquer(botGame.ref(0, 0));
    botTarget.conquer(botGame.ref(0, 1));
    while (botGame.inSpawnPhase()) {
      botGame.executeNextTick();
    }
    // Bot is stronger
    jest.spyOn(botOverlord, "troops").mockReturnValue(100);
    jest.spyOn(botTarget, "troops").mockReturnValue(1000);
    jest.spyOn(botOverlord, "numTilesOwned").mockReturnValue(1);
    jest.spyOn(botTarget, "numTilesOwned").mockReturnValue(5);
    jest.spyOn(botTarget, "borderTiles").mockReturnValue(new Set<number>());

    botGame.addExecution(new VassalOfferExecution(botOverlord, botTarget.id()));
    botGame.executeNextTick();
    botGame.executeNextTick(); // allow execution to process after init

    expect(botGame.vassalages().length).toBe(0);
    expect(botTarget.overlord()).toBeNull();
  });

  test("vassal offer execution does not auto-apply for humans", () => {
    game.addExecution(new VassalOfferExecution(player1, player2.id()));
    game.executeNextTick();
    game.executeNextTick(); // allow execution to process after init

    expect(game.vassalages().length).toBe(0);
    expect(player2.overlord()).toBeNull();
  });
});
