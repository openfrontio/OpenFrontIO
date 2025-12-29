import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import {
  AllianceRequest,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Tick,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;
let requestor: Player;
let allianceBehavior: NationAllianceBehavior;

describe("AllianceBehavior.handleAllianceRequests", () => {
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

    // Use a fixed random seed for deterministic behavior
    const random = new PseudoRandom(46);

    allianceBehavior = new NationAllianceBehavior(
      random,
      game,
      player,
      new NationEmojiBehavior(random, game, player),
    );
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

    jest.spyOn(player, "alliances").mockReturnValue(new Array(alliancesCount));

    const mockRequest = {
      requestor: () => requestor,
      recipient: () => player,
      createdAt: () => 0 as unknown as Tick,
      accept: jest.fn(),
      reject: jest.fn(),
    } as unknown as AllianceRequest;

    jest
      .spyOn(player, "incomingAllianceRequests")
      .mockReturnValue([mockRequest]);

    return mockRequest;
  }

  test("should accept alliance when all conditions are met", () => {
    const request = setupAllianceRequest({});

    allianceBehavior.handleAllianceRequests();

    expect(request.accept).toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
  });

  test("should reject alliance if requestor is a traitor", () => {
    const request = setupAllianceRequest({ isTraitor: true });

    allianceBehavior.handleAllianceRequests();

    expect(request.accept).not.toHaveBeenCalled();
    expect(request.reject).toHaveBeenCalled();
  });

  test("should reject alliance if relation is hostile", () => {
    const request = setupAllianceRequest({ relationDelta: -2 });

    allianceBehavior.handleAllianceRequests();

    expect(request.accept).not.toHaveBeenCalled();
    expect(request.reject).toHaveBeenCalled();
  });

  test("should accept alliance if requestor is much larger (> 3 times size of recipient)", () => {
    const request = setupAllianceRequest({
      numTilesRequestor: 40,
    });

    allianceBehavior.handleAllianceRequests();

    expect(request.accept).toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
  });

  test("should reject alliance if player has too many alliances", () => {
    const request = setupAllianceRequest({ alliancesCount: 10 });

    allianceBehavior.handleAllianceRequests();

    expect(request.accept).not.toHaveBeenCalled();
    expect(request.reject).toHaveBeenCalled();
  });
});

describe("AllianceBehavior.handleAllianceExtensionRequests", () => {
  let mockGame: any;
  let mockPlayer: any;
  let mockAlliance: any;
  let mockHuman: any;
  let mockRandom: any;
  let allianceBehavior: NationAllianceBehavior;

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
      relation: jest.fn(),
      id: jest.fn(() => "bot_id"),
      type: jest.fn(() => PlayerType.Nation),
    };

    allianceBehavior = new NationAllianceBehavior(
      mockRandom,
      mockGame,
      mockPlayer,
      new NationEmojiBehavior(mockRandom, mockGame, mockPlayer),
    );
  });

  it("should NOT request extension if onlyOneAgreedToExtend is false (no expiration yet or both already agreed)", () => {
    mockAlliance.onlyOneAgreedToExtend.mockReturnValue(false);
    allianceBehavior.handleAllianceExtensionRequests();
    expect(mockGame.addExecution).not.toHaveBeenCalled();
  });
});
