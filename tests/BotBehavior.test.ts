import { AllianceExtensionExecution } from "../src/core/execution/alliance/AllianceExtensionExecution";
import { BotBehavior } from "../src/core/execution/utils/BotBehavior";
import {
  AllianceRequest,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Relation,
  Tick,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;
let requestor: Player;
let botBehavior: BotBehavior;

describe("BotBehavior.handleAllianceRequests", () => {
  beforeEach(async () => {
    game = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
    });

    const playerInfo = new PlayerInfo(
      "player_id",
      PlayerType.Bot,
      null,
      "player_id",
    );
    const requestorInfo = new PlayerInfo(
      "requestor_id",
      PlayerType.Human,
      null,
      "requestor_id",
    );

    game.addPlayer(playerInfo);
    game.addPlayer(requestorInfo);

    player = game.player("player_id");
    requestor = game.player("requestor_id");

    const random = new PseudoRandom(42);

    botBehavior = new BotBehavior(random, game, player, 0.5, 0.5, 0.2);
  });

  function setupAllianceRequest({
    isTraitor = false,
    relationDelta = 2,
    numTilesPlayer = 10,
    numTilesRequestor = 10,
    alliancesCount = 0,
  } = {}) {
    if (isTraitor) requestor.markTraitor();

    player.updateRelation(requestor, relationDelta);
    requestor.updateRelation(player, relationDelta);

    game.map().forEachTile((tile) => {
      if (game.map().isLand(tile)) {
        if (numTilesPlayer > 0) {
          player.conquer(tile);
          numTilesPlayer--;
        } else if (numTilesRequestor > 0) {
          requestor.conquer(tile);
          numTilesRequestor--;
        }
      }
    });

    jest
      .spyOn(requestor, "alliances")
      .mockReturnValue(new Array(alliancesCount));

    const mockRequest = {
      accept: jest.fn(),
      createdAt: () => 0 as unknown as Tick,
      recipient: () => player,
      reject: jest.fn(),
      requestor: () => requestor,
    } as unknown as AllianceRequest;

    jest
      .spyOn(player, "incomingAllianceRequests")
      .mockReturnValue([mockRequest]);

    return mockRequest;
  }

  test("should accept alliance when all conditions are met", () => {
    const request = setupAllianceRequest({});

    botBehavior.handleAllianceRequests();

    expect(request.accept).toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
  });

  test("should reject alliance if requestor is a traitor", () => {
    const request = setupAllianceRequest({ isTraitor: true });

    botBehavior.handleAllianceRequests();

    expect(request.accept).not.toHaveBeenCalled();
    expect(request.reject).toHaveBeenCalled();
  });

  test("should reject alliance if relation is malicious", () => {
    const request = setupAllianceRequest({ relationDelta: -2 });

    botBehavior.handleAllianceRequests();

    expect(request.accept).not.toHaveBeenCalled();
    expect(request.reject).toHaveBeenCalled();
  });

  test("should accept alliance if requestor is much larger (> 3 times size of recipient) and has too many alliances (>= 3)", () => {
    const request = setupAllianceRequest({
      alliancesCount: 4,
      numTilesRequestor: 40,
    });

    botBehavior.handleAllianceRequests();

    expect(request.accept).toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
  });

  test("should accept alliance if requestor is much larger (> 3 times size of recipient) and does not have too many alliances (< 3)", () => {
    const request = setupAllianceRequest({
      alliancesCount: 2,
      numTilesRequestor: 40,
    });

    botBehavior.handleAllianceRequests();

    expect(request.accept).toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
  });

  test("should reject alliance if requestor is acceptably small (<= 3 times size of recipient) and has too many alliances (>= 3)", () => {
    const request = setupAllianceRequest({ alliancesCount: 3 });

    botBehavior.handleAllianceRequests();

    expect(request.accept).not.toHaveBeenCalled();
    expect(request.reject).toHaveBeenCalled();
  });
});

describe("BotBehavior.handleAllianceExtensionRequests", () => {
  let mockGame: any;
  let mockPlayer: any;
  let mockAlliance: any;
  let mockHuman: any;
  let mockRandom: any;
  let botBehavior: BotBehavior;

  beforeEach(() => {
    mockGame = { addExecution: jest.fn() };
    mockHuman = { id: jest.fn(() => "human_id") };
    mockAlliance = {
      onlyOneAgreedToExtend: jest.fn(() => true),
      other: jest.fn(() => mockHuman),
    };
    mockRandom = { chance: jest.fn() };

    mockPlayer = {
      alliances: jest.fn(() => [mockAlliance]),
      id: jest.fn(() => "bot_id"),
      relation: jest.fn(),
      type: jest.fn(() => PlayerType.FakeHuman),
    };

    botBehavior = new BotBehavior(
      mockRandom,
      mockGame,
      mockPlayer,
      0.5,
      0.5,
      0.2,
    );
  });

  it("should NOT request extension if onlyOneAgreedToExtend is false (no expiration yet or both already agreed)", () => {
    mockAlliance.onlyOneAgreedToExtend.mockReturnValue(false);
    botBehavior.handleAllianceExtensionRequests();
    expect(mockGame.addExecution).not.toHaveBeenCalled();
  });

  it("should always extend if type Bot", () => {
    mockPlayer.type.mockReturnValue(PlayerType.Bot);
    botBehavior.handleAllianceExtensionRequests();
    expect(mockGame.addExecution).toHaveBeenCalledTimes(1);
    expect(mockGame.addExecution.mock.calls[0][0]).toBeInstanceOf(
      AllianceExtensionExecution,
    );
  });

  it("should always extend if Nation and relation is Friendly", () => {
    mockPlayer.relation.mockReturnValue(Relation.Friendly);
    botBehavior.handleAllianceExtensionRequests();
    expect(mockGame.addExecution).toHaveBeenCalledTimes(1);
    expect(mockGame.addExecution.mock.calls[0][0]).toBeInstanceOf(
      AllianceExtensionExecution,
    );
  });

  it("should extend if Nation, relation is Neutral and random chance is true", () => {
    mockPlayer.relation.mockReturnValue(Relation.Neutral);
    mockRandom.chance.mockReturnValue(true);
    botBehavior.handleAllianceExtensionRequests();
    expect(mockGame.addExecution).toHaveBeenCalledTimes(1);
    expect(mockGame.addExecution.mock.calls[0][0]).toBeInstanceOf(
      AllianceExtensionExecution,
    );
  });

  it("should NOT extend if Nation, relation is Neutral and random chance is false", () => {
    mockPlayer.relation.mockReturnValue(Relation.Neutral);
    mockRandom.chance.mockReturnValue(false);
    botBehavior.handleAllianceExtensionRequests();
    expect(mockGame.addExecution).not.toHaveBeenCalled();
  });
});
