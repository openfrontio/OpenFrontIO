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
    game = await setup("BigPlains", { infiniteGold: true, instantBuild: true });

    const playerInfo = new PlayerInfo(
      "us",
      "player_id",
      PlayerType.Bot,
      null,
      "player_id",
    );
    const requestorInfo = new PlayerInfo(
      "fr",
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

    botBehavior = new BotBehavior(random, game, player, 0.5, 0.5);
  });

  function setupAllianceRequestMocks({
    isTraitor = false,
    relation = Relation.Neutral,
    numTiles = 10,
    alliancesCount = 0,
  } = {}) {
    jest.spyOn(requestor, "isTraitor").mockReturnValue(isTraitor);
    jest.spyOn(player, "relation").mockReturnValue(relation);
    jest.spyOn(requestor, "numTilesOwned").mockReturnValue(numTiles);
    jest.spyOn(player, "numTilesOwned").mockReturnValue(10);
    jest
      .spyOn(requestor, "alliances")
      .mockReturnValue(new Array(alliancesCount));

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
    const request = setupAllianceRequestMocks({});

    botBehavior.handleAllianceRequests();

    expect(request.accept).toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
  });

  test("should reject alliance if requestor is a traitor", () => {
    const request = setupAllianceRequestMocks({ isTraitor: true });

    botBehavior.handleAllianceRequests();

    expect(request.accept).not.toHaveBeenCalled();
    expect(request.reject).toHaveBeenCalled();
  });

  test("should reject alliance if relation is malicious", () => {
    const request = setupAllianceRequestMocks({ relation: Relation.Hostile });

    botBehavior.handleAllianceRequests();

    expect(request.accept).not.toHaveBeenCalled();
    expect(request.reject).toHaveBeenCalled();
  });

  test("should accept alliance if requestor is much larger (> 3 times size of recipient) and has too many alliances (>= 3)", () => {
    const request = setupAllianceRequestMocks({
      numTiles: 40,
      alliancesCount: 4,
    });

    botBehavior.handleAllianceRequests();

    expect(request.accept).toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
  });

  test("should accept alliance if requestor is much larger (> 3 times size of recipient) and does not have too many alliances (< 3)", () => {
    const request = setupAllianceRequestMocks({
      numTiles: 40,
      alliancesCount: 2,
    });

    botBehavior.handleAllianceRequests();

    expect(request.accept).toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
  });

  test("should reject alliance if requestor is acceptably small (<= 3 times size of recipient) and has too many alliances (>= 3)", () => {
    const request = setupAllianceRequestMocks({ alliancesCount: 3 });

    botBehavior.handleAllianceRequests();

    expect(request.accept).not.toHaveBeenCalled();
    expect(request.reject).toHaveBeenCalled();
  });

  test("should accept alliance if requestor is acceptably small (<= 3 times size of recipient) and does not have too many alliances (< 3)", () => {
    const request = setupAllianceRequestMocks({ alliancesCount: 2 });

    botBehavior.handleAllianceRequests();

    expect(request.accept).toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
  });
});
