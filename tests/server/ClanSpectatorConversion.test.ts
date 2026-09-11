import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  Duos,
  GameMapType,
  GameMode,
  Quads,
  Trios,
} from "../../src/core/game/Game";
import { ServerStartGameMessage } from "../../src/core/Schemas";
import { createGameWireContext } from "../../src/core/ZbinWire";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// One turn of the server clock; ServerEnv.turnIntervalMs().
const TURN_MS = 100;

describe("GameServer - Clan Overflow Spectator Conversion", () => {
  // start() schedules a 100 ms turn interval that only end() clears, and no
  // test here ends its game -- every one of them used to leave a live timer
  // behind. When one fired after the run it encoded a turn against gone
  // fixtures and failed the whole job from outside any test. Faking the clock
  // makes the leak structurally impossible rather than something each test has
  // to remember to clean up.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test("Clan members overflowing maxTeamSize are converted to spectators", () => {
    const game = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
      },
    });

    const clients = [
      makeClient({ clientID: cid("c1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c4"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c5"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c6"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("c7"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("c8"), clanTag: "OTHER" }),
    ];

    for (const c of clients) {
      game.joinClient(c);
    }

    // 8 players, 2 teams -> maxTeamSize = ceil(8 / 2) = 4
    startGame(game);

    const startMsg = mockWsOf(clients[0])
      .sent()
      .find((m): m is ServerStartGameMessage => m.type === "start");
    expect(startMsg).toBeDefined();

    const startPlayers = startMsg!.gameStartInfo.players;

    // Exactly 4 CLAN members in start info
    const clanPlayers = startPlayers.filter((p) => p.clanTag === "CLAN");
    expect(clanPlayers).toHaveLength(4);

    // 5th CLAN member converted to spectator
    expect(clients[4].spectator).toBe(true);

    // First 4 remain players
    expect(clients.slice(0, 4).every((c) => !c.spectator)).toBe(true);
  });

  test("Matchmaking games exempt clan members from spectator conversion", () => {
    // In matchmade games, the matchmaker already placed clients and balanced teams.
    const game = makeGame({
      matchmakingTeams: [
        [cid("ma"), cid("mb"), cid("mc"), cid("md"), cid("me")],
        [cid("mf"), cid("mg"), cid("mh"), cid("mi"), cid("mj")],
      ],
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
      },
    });

    const clients = [
      makeClient({ clientID: cid("ma"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("mb"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("mc"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("md"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("me"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("mf"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("mg"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("mh"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("mi"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("mj"), clanTag: "OTHER" }),
    ];

    for (const c of clients) {
      game.joinClient(c);
    }

    startGame(game);

    // All 5 CLAN members remain players because matchmaker assigned them
    expect(clients.every((c) => !c.spectator)).toBe(true);
  });

  test("Queued intents from converted clan overflow spectators are pruned", async () => {
    const game = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
      },
    });

    const clients = [
      makeClient({ clientID: cid("c1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c4"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c5"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c6"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("c7"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("c8"), clanTag: "OTHER" }),
    ];

    for (const c of clients) {
      game.joinClient(c);
    }

    // Queue an intent from c1 (kept) and c5 (converted to spectator) through
    // the socket a real client uses, rather than pushing onto the private
    // queue: gameplay intents are queued regardless of stage (the default
    // branch of handleIntent), so this works before the start.
    await mockWsOf(clients[0]).emit({
      type: "intent",
      intent: { type: "spawn", tile: 1 },
    });
    await mockWsOf(clients[4]).emit({
      type: "intent",
      intent: { type: "spawn", tile: 2 },
    });

    startGame(game);

    // c5 is over the clan cap, so it is converted to a spectator.
    expect(clients[4].spectator).toBe(true);

    // Assert on what actually reaches the wire, not on the private array: the
    // first turn frame is the observable consequence of the pruning.
    const startMsg = mockWsOf(clients[0])
      .sent()
      .find((m): m is ServerStartGameMessage => m.type === "start");
    expect(startMsg).toBeDefined();
    const ctx = createGameWireContext(startMsg!.gameStartInfo.players);

    vi.advanceTimersByTime(TURN_MS);

    const turn = mockWsOf(clients[0])
      .sent(ctx)
      .find((m) => m.type === "turn");
    expect(turn?.type).toBe("turn");
    if (turn?.type !== "turn") return;

    const intentClientIDs = turn.turn.intents.map((i) => i.clientID);
    // The converted spectator's queued intent never reaches a turn...
    expect(intentClientIDs).not.toContain(cid("c5"));
    // ...while the kept player's does.
    expect(intentClientIDs).toContain(cid("c1"));
  });

  test("Pinned matchmaking players seeded by index are exempt from conversion", () => {
    const game = makeGame({
      matchmakingTeams: [
        [cid("p1"), cid("p2"), cid("p3")],
        [cid("p4"), cid("p5"), cid("p6")],
      ],
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
      },
    });

    const clients = [
      makeClient({ clientID: cid("p1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("p2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("p3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("p4"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("p5"), clanTag: "OTHER" }),
      makeClient({ clientID: cid("p6"), clanTag: "OTHER" }),
    ];

    for (const c of clients) game.joinClient(c);
    startGame(game);

    expect(clients.every((c) => !c.spectator)).toBe(true);
  });

  test("Fixed playerTeams config (Duos, Trios, Quads) strictly limits clan size", () => {
    // Quads: team size = 4
    const quadsGame = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: Quads,
      },
    });
    const quadsClients = [
      makeClient({ clientID: cid("q1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("q2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("q3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("q4"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("q5"), clanTag: "CLAN" }),
    ];
    for (const c of quadsClients) quadsGame.joinClient(c);
    startGame(quadsGame);

    expect(quadsClients.slice(0, 4).every((c) => !c.spectator)).toBe(true);
    expect(quadsClients[4].spectator).toBe(true);

    // Trios: team size = 3
    const triosGame = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: Trios,
      },
    });
    const triosClients = [
      makeClient({ clientID: cid("t1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("t2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("t3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("t4"), clanTag: "CLAN" }),
    ];
    for (const c of triosClients) triosGame.joinClient(c);
    startGame(triosGame);

    expect(triosClients.slice(0, 3).every((c) => !c.spectator)).toBe(true);
    expect(triosClients[3].spectator).toBe(true);

    // Duos: team size = 2
    const duosGame = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: Duos,
      },
    });
    const duosClients = [
      makeClient({ clientID: cid("d1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("d2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("d3"), clanTag: "CLAN" }),
    ];
    for (const c of duosClients) duosGame.joinClient(c);
    startGame(duosGame);

    expect(duosClients.slice(0, 2).every((c) => !c.spectator)).toBe(true);
    expect(duosClients[2].spectator).toBe(true);
  });

  test("Variable player size with nations accounts for nation slider count", () => {
    // 5 clan players with 201 nations in 2 teams -> capacity ceil((5+201)/2) = 103 -> none converted
    const game = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: 201,
      },
    });
    const clients = [
      makeClient({ clientID: cid("n1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("n2"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("n3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("n4"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("n5"), clanTag: "CLAN" }),
    ];
    for (const c of clients) game.joinClient(c);
    startGame(game);

    for (const c of clients) {
      expect(c.spectator).toBe(false);
    }
  });

  test("Clan overflow accounts for default map nation count in variable team sizing", () => {
    // World map has 72 default nations.
    // Case A: 10 players in clan CLAN (total = 10 + 72 = 82):
    // maxTeamSize = ceil(82 / 2) = 41.
    // All 10 clan members should remain active players.
    const game = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "default",
        gameMap: GameMapType.World,
      },
    });
    const clients = Array.from({ length: 10 }, (_, i) =>
      makeClient({ clientID: cid(`d${i}`), clanTag: "CLAN" }),
    );
    for (const c of clients) game.joinClient(c);
    startGame(game);

    for (const c of clients) {
      expect(c.spectator).toBe(false);
    }

    // Case B: Map with 0 default nations (e.g. BaikalNukeWars) and 2 teams:
    // 5 clan members and 3 opposing players on BaikalNukeWars with 2 teams ->
    // total = 8. maxTeamSize = ceil(8 / 2) = 4.
    // First 4 fit, 5th is converted to spectator!
    const zeroNationsGame = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "default",
        gameMap: GameMapType.BaikalNukeWars,
      },
    });
    const clanClients = Array.from({ length: 5 }, (_, i) =>
      makeClient({ clientID: cid(`z${i}`), clanTag: "CLAN" }),
    );
    const otherClients = Array.from({ length: 3 }, (_, i) =>
      makeClient({ clientID: cid(`o${i}`), clanTag: "OTHER" }),
    );
    for (const c of [...clanClients, ...otherClients]) {
      zeroNationsGame.joinClient(c);
    }
    startGame(zeroNationsGame);

    expect(clanClients.slice(0, 4).every((c) => !c.spectator)).toBe(true);
    expect(clanClients[4].spectator).toBe(true);
    expect(otherClients.every((c) => !c.spectator)).toBe(true);
  });

  test("disableClanTags and anonymizeNames exempt clan members from conversion", () => {
    const disabledClanTagsGame = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
        disableClanTags: true,
      },
    });
    const clientsA = Array.from({ length: 5 }, (_, i) =>
      makeClient({ clientID: cid(`a${i}`), clanTag: "CLAN" }),
    );
    const opponentsA = Array.from({ length: 3 }, (_, i) =>
      makeClient({ clientID: cid(`oa${i}`), clanTag: "OTHER" }),
    );
    for (const c of [...clientsA, ...opponentsA]) {
      disabledClanTagsGame.joinClient(c);
    }
    startGame(disabledClanTagsGame);
    expect(clientsA.every((c) => !c.spectator)).toBe(true);

    const anonymizeGame = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: 2,
        nations: "disabled",
        anonymizeNames: true,
      },
    });
    const clientsB = Array.from({ length: 5 }, (_, i) =>
      makeClient({ clientID: cid(`b${i}`), clanTag: "CLAN" }),
    );
    const opponentsB = Array.from({ length: 3 }, (_, i) =>
      makeClient({ clientID: cid(`ob${i}`), clanTag: "OTHER" }),
    );
    for (const c of [...clientsB, ...opponentsB]) {
      anonymizeGame.joinClient(c);
    }
    startGame(anonymizeGame);
    expect(clientsB.every((c) => !c.spectator)).toBe(true);
  });

  test("Small roster Quads dynamically caps team size below 4", () => {
    // 9 players on BaikalNukeWars (0 nations) with Quads:
    // Math.ceil(9 / 4) = 3 teams. maxTeamSize = Math.ceil(9 / 3) = 3 (< 4).
    // Clan of 4 gets 1 member benched to spectator.
    const game = makeGame({
      config: {
        gameMode: GameMode.Team,
        playerTeams: Quads,
        nations: "default",
        gameMap: GameMapType.BaikalNukeWars,
      },
    });
    const clanClients = Array.from({ length: 4 }, (_, i) =>
      makeClient({ clientID: cid(`q${i}`), clanTag: "CLAN" }),
    );
    const soloClients = Array.from({ length: 5 }, (_, i) =>
      makeClient({ clientID: cid(`s${i}`) }),
    );
    for (const c of [...clanClients, ...soloClients]) game.joinClient(c);
    startGame(game);

    expect(clanClients.slice(0, 3).every((c) => !c.spectator)).toBe(true);
    expect(clanClients[3].spectator).toBe(true);
    expect(soloClients.every((c) => !c.spectator)).toBe(true);
  });
});
