import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import {
  AllianceRequest,
  Difficulty,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Tick,
  UnitType,
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
    createdAtTick = game.config().numSpawnPhaseTurns() + 2,
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

    vi.spyOn(player, "alliances").mockReturnValue(new Array(alliancesCount));

    const mockRequest = {
      requestor: () => requestor,
      recipient: () => player,
      createdAt: () => createdAtTick as unknown as Tick,
      accept: vi.fn(),
      reject: vi.fn(),
    } as unknown as AllianceRequest;

    vi.spyOn(player, "incomingAllianceRequests").mockReturnValue([mockRequest]);

    return mockRequest;
  }

  test("should reject alliance created on first post-spawn tick", () => {
    const cutoff = game.config().numSpawnPhaseTurns() + 1;
    const request = setupAllianceRequest({ createdAtTick: cutoff });

    allianceBehavior.handleAllianceRequests();

    expect(request.accept).not.toHaveBeenCalled();
    expect(request.reject).toHaveBeenCalled();
  });

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
    mockGame = {
      addExecution: vi.fn(),
      config: vi.fn(() => ({ disableAlliances: vi.fn(() => false) })),
    };
    mockHuman = { id: vi.fn(() => "human_id") };
    mockAlliance = {
      onlyOneAgreedToExtend: vi.fn(() => true),
      other: vi.fn(() => mockHuman),
    };
    mockRandom = { chance: vi.fn() };

    mockPlayer = {
      alliances: vi.fn(() => [mockAlliance]),
      relation: vi.fn(),
      id: vi.fn(() => "bot_id"),
      type: vi.fn(() => PlayerType.Nation),
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

describe("AllianceBehavior.maybeBetray - juicy ally strategy", () => {
  /**
   * Player allied with `allyJuicy` (extra tiles + an upgraded city, so it
   * scores juicier) and `allyMeh` (plain), plus a non-allied `threat`
   * bordering the player. `maybeBetray` is called directly with hand-built
   * bordering lists, so no real map adjacency between these players is needed.
   */
  async function setupBetrayTest(
    difficulty: Difficulty,
    {
      threatTroops = 5_000,
      threatOutgoingTroops = 0,
      allyMehTroops = 10_000,
    } = {},
  ) {
    const testGame = await setup(
      "big_plains",
      { infiniteGold: true, difficulty },
      [
        new PlayerInfo("player", PlayerType.Nation, null, "player_id"),
        new PlayerInfo("allyJuicy", PlayerType.Human, null, "ally_juicy_id"),
        new PlayerInfo("allyMeh", PlayerType.Human, null, "ally_meh_id"),
        new PlayerInfo("threat", PlayerType.Human, null, "threat_id"),
      ],
    );

    const player = testGame.player("player_id");
    const allyJuicy = testGame.player("ally_juicy_id");
    const allyMeh = testGame.player("ally_meh_id");
    const threat = testGame.player("threat_id");

    let assigned = 0;
    const owners = [player, allyJuicy, allyMeh, threat];
    testGame.map().forEachTile((tile) => {
      if (assigned >= 80) return;
      if (!testGame.map().isLand(tile)) return;
      owners[assigned % 4].conquer(tile);
      assigned++;
    });

    // Give allyJuicy extra territory + an upgraded city - the actual prize.
    let extra = 0;
    testGame.map().forEachTile((tile) => {
      if (extra >= 100) return;
      if (!testGame.map().isLand(tile) || testGame.hasOwner(tile)) return;
      allyJuicy.conquer(tile);
      extra++;
    });
    const city = allyJuicy.buildUnit(
      UnitType.City,
      Array.from(allyJuicy.tiles())[0],
      {},
    );
    city.increaseLevel();
    city.increaseLevel();

    player.setTroops(100_000);
    allyJuicy.setTroops(10_000);
    allyMeh.setTroops(allyMehTroops);
    threat.setTroops(threatTroops);
    if (threatOutgoingTroops > 0) {
      // createAttack() directly (no execution/tick) - registers the attack in
      // threat.outgoingAttacks() without ticking the game, which would also
      // run every Nation's own AI turn and disturb the state set up above.
      threat.createAttack(player, threatOutgoingTroops, null, new Set());
    }

    // Form real alliances so isAlliedWith()/allianceWith() behave normally.
    for (const ally of [allyJuicy, allyMeh]) {
      testGame.addExecution(new AllianceRequestExecution(player, ally.id()));
      testGame.executeNextTick();
      testGame.addExecution(new AllianceRequestExecution(ally, player.id()));
      testGame.executeNextTick();
    }
    expect(player.isAlliedWith(allyJuicy)).toBe(true);
    expect(player.isAlliedWith(allyMeh)).toBe(true);

    const random = new PseudoRandom(42);
    const allianceBehavior = new NationAllianceBehavior(
      random,
      testGame,
      player,
      new NationEmojiBehavior(random, testGame, player),
    );

    return { testGame, player, allyJuicy, allyMeh, threat, allianceBehavior };
  }

  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s: betrays the juicier ally when nearby non-allied players are weak",
    async (difficulty) => {
      const { player, allyJuicy, allyMeh, threat, allianceBehavior } =
        await setupBetrayTest(difficulty);

      const result = allianceBehavior.maybeBetray(
        allyJuicy,
        allianceBehavior.findJuiciestAlly([allyJuicy, allyMeh]),
        [allyJuicy, allyMeh],
        [threat],
      );

      expect(result).toBe(true);
      expect(player.isAlliedWith(allyJuicy)).toBe(false);
    },
  );

  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s: does not betray the less juicy ally, even though it's also weak enough to attack",
    async (difficulty) => {
      const { player, allyJuicy, allyMeh, threat, allianceBehavior } =
        await setupBetrayTest(difficulty);

      const result = allianceBehavior.maybeBetray(
        allyMeh,
        allianceBehavior.findJuiciestAlly([allyJuicy, allyMeh]),
        [allyJuicy, allyMeh],
        [threat],
      );

      expect(result).toBe(false);
      expect(player.isAlliedWith(allyMeh)).toBe(true);
    },
  );

  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s: does not betray the juiciest ally when a nearby non-allied player is strong enough to punish it",
    async (difficulty) => {
      const { player, allyJuicy, allyMeh, threat, allianceBehavior } =
        await setupBetrayTest(difficulty, { threatTroops: 60_000 });

      const result = allianceBehavior.maybeBetray(
        allyJuicy,
        allianceBehavior.findJuiciestAlly([allyJuicy, allyMeh]),
        [allyJuicy, allyMeh],
        [threat],
      );

      expect(result).toBe(false);
      expect(player.isAlliedWith(allyJuicy)).toBe(true);
    },
  );

  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s: counts a nearby threat's outgoing attack troops toward the safety check",
    async (difficulty) => {
      const { player, allyJuicy, allyMeh, threat, allianceBehavior } =
        await setupBetrayTest(difficulty, {
          threatTroops: 10_000,
          threatOutgoingTroops: 45_000,
        });

      const result = allianceBehavior.maybeBetray(
        allyJuicy,
        allianceBehavior.findJuiciestAlly([allyJuicy, allyMeh]),
        [allyJuicy, allyMeh],
        [threat],
      );

      expect(result).toBe(false);
      expect(player.isAlliedWith(allyJuicy)).toBe(true);
    },
  );

  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s: does not betray a non-traitor ally when another current ally could turn on the resulting traitor for free",
    async (difficulty) => {
      // Betraying a non-traitor makes `player` a traitor (see breakAlliance()
      // in GameImpl), so allyMeh could then betray `player` without becoming
      // a traitor itself - it must count as a threat here too.
      const { player, allyJuicy, allyMeh, threat, allianceBehavior } =
        await setupBetrayTest(difficulty, { allyMehTroops: 40_000 });

      const result = allianceBehavior.maybeBetray(
        allyJuicy,
        allianceBehavior.findJuiciestAlly([allyJuicy, allyMeh]),
        [allyJuicy, allyMeh],
        [threat],
      );

      expect(result).toBe(false);
      expect(player.isAlliedWith(allyJuicy)).toBe(true);
    },
  );

  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s: betrays an already-traitor ally regardless of other allies' strength",
    async (difficulty) => {
      // Betraying an already-traitor target doesn't make `player` a traitor
      // (see breakAlliance()), so allyMeh's strength is irrelevant here.
      const { player, allyJuicy, allyMeh, threat, allianceBehavior } =
        await setupBetrayTest(difficulty, { allyMehTroops: 40_000 });
      allyJuicy.markTraitor();

      const result = allianceBehavior.maybeBetray(
        allyJuicy,
        allianceBehavior.findJuiciestAlly([allyJuicy, allyMeh]),
        [allyJuicy, allyMeh],
        [threat],
      );

      expect(result).toBe(true);
      expect(player.isAlliedWith(allyJuicy)).toBe(false);
    },
  );

  it.each([Difficulty.Hard, Difficulty.Impossible])(
    "%s: does not count a friendly-but-not-allied bordering player (e.g. a teammate) as a betrayal threat",
    async (difficulty) => {
      const { allyJuicy, allianceBehavior } = await setupBetrayTest(difficulty);

      // borderingFriends can hold teammates too (isFriendly() = isOnSameTeam()
      // || isAlliedWith()), but a teammate is never actually allied with us
      // and can never attack us - it must not count as a threat.
      const teammate = {
        isTraitor: () => false,
        troops: () => 200_000,
        outgoingAttacks: () => [],
      } as unknown as Player;

      const result = (allianceBehavior as any).isSafeToBetray(
        allyJuicy,
        [allyJuicy, teammate],
        [],
      );

      expect(result).toBe(true);
    },
  );
});
