import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/Schemas", async () => {
  const actual = (await vi.importActual("../../src/core/Schemas")) as any;
  return {
    ...actual,
    GameStartInfoSchema: {
      safeParse: (data: any) => ({ success: true, data }),
    },
    ServerPrestartMessageSchema: {
      safeParse: (data: any) => ({ success: true, data }),
    },
  };
});

import { GameType, RankedType } from "../../src/core/game/Game";
import { ClientMessage } from "../../src/core/Schemas";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";
import { clientFrame, testGameConfig } from "../util/Wire";

function makeMockWs() {
  const handlers = new Map<string, (msg: Buffer) => void>();
  return {
    on: (event: string, fn: (msg: Buffer) => void) => handlers.set(event, fn),
    removeAllListeners: () => handlers.clear(),
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    /** Drive the socket the way a connected client would. */
    emit: (msg: ClientMessage) => handlers.get("message")?.(clientFrame(msg)),
  };
}

function makeClient(
  id: string,
  spectator = false,
  friends: string[] = [],
): Client {
  return new Client(
    id,
    `${id}-pid`,
    null,
    null,
    undefined,
    // Distinct per client: the winner vote is weighted by unique IP, so a shared
    // one would collapse every electorate to a single voter.
    `10.0.0.${ipOctet++}`,
    id,
    null,
    makeMockWs() as any,
    undefined,
    `${id}-pub`,
    friends,
    spectator,
  );
}

let ipOctet = 1;

describe("GameServer - spectators", () => {
  let logger: any;

  beforeEach(() => {
    vi.useFakeTimers();
    ipOctet = 1;
    logger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const makeGame = (maxPlayers?: number) =>
    new GameServer(
      "g1",
      logger,
      Date.now(),
      testGameConfig({ gameType: GameType.Private, maxPlayers }),
    );

  it("takes no lobby slot, so a full game is still watchable", () => {
    const game = makeGame(2);
    expect(game.joinClient(makeClient("p1"))).toBe("joined");
    expect(game.joinClient(makeClient("p2"))).toBe("joined");
    expect(game.joinClient(makeClient("p3"))).toBe("rejected");
    expect(game.joinClient(makeClient("cast", true))).toBe("joined");
  });

  it("does not let a spectator use up a seat a player could have had", () => {
    const game = makeGame(2);
    expect(game.joinClient(makeClient("cast", true))).toBe("joined");
    expect(game.joinClient(makeClient("p1"))).toBe("joined");
    expect(game.joinClient(makeClient("p2"))).toBe("joined");
  });

  it("is left out of the player list handed to the simulation", () => {
    // Anyone in gameStartInfo.players gets spawned, so a spectator in that list
    // would be playing.
    const game = makeGame();
    game.joinClient(makeClient("p1"));
    game.joinClient(makeClient("cast", true));
    game.start();
    const info = (game as any).gameStartInfo;
    expect(info).toBeDefined();
    expect(info.players.map((p: any) => p.clientID)).toEqual(["p1"]);
  });

  it("still has to be on the allowlist when the lobby sets one", () => {
    // Taking no slot must not become a way around the allowlist.
    const game = new GameServer(
      "g1",
      logger,
      Date.now(),
      testGameConfig({
        gameType: GameType.Private,
        allowedPublicIds: ["p1-pub"],
      }),
    );
    expect(game.joinClient(makeClient("cast", true))).toBe("not_allowlisted");
    expect(game.joinClient(makeClient("p1", true))).toBe("joined");
  });

  it("is exempt from the allowlist once the game has started", () => {
    // The field is locked at start and a spectator takes no seat, so the
    // allowlist has nothing left to protect; a caster arriving mid-game is
    // exactly who an allowlisted (tournament) lobby is cast for.
    const game = new GameServer(
      "g1",
      logger,
      Date.now(),
      testGameConfig({
        gameType: GameType.Private,
        allowedPublicIds: ["p1-pub"],
      }),
    );
    (game as any)._hasStarted = true;
    const cast = makeClient("cast", true);
    expect(game.joinClient(cast)).toBe("joined");
    expect(cast.spectator).toBe(true);
    // ...and the exemption is not a way into a seat.
    (game as any).setSpectator(cast, false);
    expect(cast.spectator).toBe(true);
  });

  it("does not exempt a non-spectator join after the start", () => {
    // Someone joining to play stays subject to the allowlist even though a
    // late join would only demote them to watching anyway.
    const game = new GameServer(
      "g1",
      logger,
      Date.now(),
      testGameConfig({
        gameType: GameType.Private,
        allowedPublicIds: ["p1-pub"],
      }),
    );
    (game as any)._hasStarted = true;
    expect(game.joinClient(makeClient("late"))).toBe("not_allowlisted");
  });

  it("does not keep a ranked match alive on its own", () => {
    // 1v1 with one player and one spectator is a one-player game, so the
    // short-handed cancel has to see through the spectator.
    const game = new GameServer(
      "g1",
      logger,
      Date.now(),
      testGameConfig({
        gameType: GameType.Private,
        maxPlayers: 2,
        rankedType: RankedType.OneVOne,
      }),
    );
    game.joinClient(makeClient("p1"));
    game.joinClient(makeClient("cast", true));
    expect((game as any).cancelShortHandedMatch()).toBe(true);
  });

  it.each(["intent", "winner", "live_stats", "hash"])(
    "drops a %s sent by a spectator",
    async (type) => {
      // Taking no slot must not buy a way into the intent stream.
      const game = makeGame();
      const spies = {
        intent: vi.spyOn(game as any, "handleIntent"),
        winner: vi.spyOn(game as any, "handleWinner"),
        live_stats: vi.spyOn(game as any, "handleLiveStats"),
      };
      const spectator = makeClient("cast", true);
      game.joinClient(spectator);
      const byType: Record<string, ClientMessage> = {
        intent: { type: "intent", intent: { type: "spawn", tile: 1 } },
        winner: { type: "winner", winner: undefined, allPlayersStats: {} },
        live_stats: { type: "live_stats", stats: { turn: 1, players: [] } },
        hash: { type: "hash", hash: 42, turnNumber: 1 },
      };
      await (spectator.ws as any).emit(byType[type]);
      if (type === "hash") {
        // hash has no handler spy — it writes client.hashes, which feeds the
        // desync agreement a spectator must not vote in.
        expect(spectator.hashes.size).toBe(0);
      } else {
        expect(spies[type as keyof typeof spies]).not.toHaveBeenCalled();
      }
    },
  );

  it("still handles those messages from a player", async () => {
    const game = makeGame();
    const handleIntent = vi.spyOn(game as any, "handleIntent");
    const player = makeClient("p1");
    game.joinClient(player);
    await (player.ws as any).emit({
      type: "intent",
      intent: { type: "spawn", tile: 1 },
    });
    expect(handleIntent).toHaveBeenCalled();
  });

  it("joining after the start makes you a spectator, not a seatless player", () => {
    // The player list is frozen at start; a late joiner used to be admitted as a
    // player who could never spawn.
    const game = makeGame();
    (game as any)._hasStarted = true;
    const late = makeClient("late");
    expect(game.joinClient(late)).toBe("joined");
    expect(late.spectator).toBe(true);
  });

  it("does not put a spectator's disconnect into the turn log", () => {
    // mark_disconnected names a player in gameStartInfo; for a spectator it
    // refers to nobody, and it is kept in the archived record where readers take
    // it as a player having dropped.
    const game = makeGame();
    const spectator = makeClient("cast", true);
    game.joinClient(spectator);
    game.joinClient(makeClient("p1"));
    (game as any).markClientDisconnected("cast", true);
    (game as any).markClientDisconnected("p1", true);
    const marked = (game as any).intents
      .filter((i: any) => i.type === "mark_disconnected")
      .map((i: any) => i.clientID);
    expect(marked).not.toContain("cast");
    expect(marked).toContain("p1");
  });

  it("keeps a spectator out of a player's friends list", () => {
    // friends feed team assignment, so a befriended spectator would put a
    // clientID that never spawns onto someone's team.
    const game = makeGame();
    const spectator = makeClient("cast", true);
    game.joinClient(spectator);
    const player = makeClient("p1", false, ["cast-pub", "p2-pub"]);
    game.joinClient(player);
    game.joinClient(makeClient("p2"));
    const friendsFor = (game as any).buildFriendsLookup();
    expect(friendsFor(player)).toEqual(["p2"]);
  });

  it("does not make the winner vote unreachable", () => {
    // The vote needs a strict majority of the electorate's IPs. Counting
    // spectators in that total but barring them from voting means four players
    // watched by five spectators can never reach consensus — so the game never
    // archives and never gets scored.
    const game = makeGame();
    const players = ["p1", "p2", "p3", "p4"].map((id) => makeClient(id));
    for (const p of players) game.joinClient(p);
    for (const id of ["c1", "c2", "c3", "c4", "c5"]) {
      game.joinClient(makeClient(id, true));
    }
    // Archiving is a separate concern and needs a started game; the quorum is
    // what's under test.
    vi.spyOn(game as any, "archiveGame").mockImplementation(() => {});
    for (const p of players) {
      (game as any).handleWinner(p, {
        type: "winner",
        winner: ["player", "p1"],
        allPlayersStats: {},
      });
    }
    expect((game as any).winner).not.toBeNull();
  });

  describe("switching between playing and watching", () => {
    const setSpectator = (game: GameServer, c: Client, spectator: boolean) =>
      (game as any).setSpectator(c, spectator);

    it("a spectator can take a free seat before the start", () => {
      const game = makeGame(2);
      const c = makeClient("cast", true);
      game.joinClient(c);
      setSpectator(game, c, false);
      expect(c.spectator).toBe(false);
      expect(
        game.gameInfo().clients?.find((x) => x.clientID === "cast")?.spectator,
      ).toBeUndefined();
    });

    it("a player can drop back to watching, freeing the seat", () => {
      const game = makeGame(1);
      const p = makeClient("p1");
      game.joinClient(p);
      expect(game.joinClient(makeClient("p2"))).toBe("rejected");
      setSpectator(game, p, true);
      expect(game.joinClient(makeClient("p2"))).toBe("joined");
    });

    it("cannot take a seat that would exceed the cap", () => {
      const game = makeGame(1);
      game.joinClient(makeClient("p1"));
      const c = makeClient("cast", true);
      game.joinClient(c);
      setSpectator(game, c, false);
      expect(c.spectator).toBe(true);
    });

    it("cannot take a seat the allowlist does not name them for", () => {
      // The allowlist can gain entries AFTER someone is already in the lobby
      // (update_game_config replaces it), so being inside is not proof of a
      // seat. Without this, the toggle is a way past the allowlist the moment
      // anything admits a non-listed spectator.
      const game = new GameServer(
        "g1",
        logger,
        Date.now(),
        testGameConfig({
          gameType: GameType.Private,
          allowedPublicIds: ["p1-pub"],
        }),
      );
      const listed = makeClient("p1", true);
      const unlisted = makeClient("cast", true);
      // Admit both while... the unlisted one cannot join an allowlisted lobby
      // today, so simulate the post-join list change: join first, then set it.
      const open = new GameServer(
        "g2",
        logger,
        Date.now(),
        testGameConfig({ gameType: GameType.Private }),
      );
      open.joinClient(unlisted);
      (open as any).gameConfig.allowedPublicIds = ["someone-else-pub"];
      setSpectator(open, unlisted, false);
      expect(unlisted.spectator).toBe(true);

      game.joinClient(listed);
      setSpectator(game, listed, false);
      expect(listed.spectator).toBe(false);
    });

    it("cannot become a player once the game has started", () => {
      // gameStartInfo.players is frozen, so a new player could never spawn.
      const game = makeGame();
      const c = makeClient("cast", true);
      game.joinClient(c);
      (game as any)._hasStarted = true;
      setSpectator(game, c, false);
      expect(c.spectator).toBe(true);
    });

    it("shows a spectator the same lobby a player sees", () => {
      // Filtering spectators out of the roster emptied the list for anyone
      // watching a lobby they were alone in. They are listed and flagged
      // instead: the lobby view does not change for them.
      const game = makeGame();
      game.joinClient(makeClient("p1"));
      game.joinClient(makeClient("cast", true));
      const seen = game.gameInfo("cast").clients ?? [];
      expect(seen.map((c) => c.clientID)).toEqual(["p1", "cast"]);
      expect(seen.find((c) => c.clientID === "p1")?.spectator).toBeUndefined();
      expect(seen.find((c) => c.clientID === "cast")?.spectator).toBe(true);
    });
  });

  it("may join after the game has started", () => {
    // A caster arriving mid-game is the normal case; a late player already
    // gets the same treatment, so this only has to keep working.
    const game = makeGame();
    (game as any)._hasStarted = true;
    expect(game.joinClient(makeClient("cast", true))).toBe("joined");
  });
});
