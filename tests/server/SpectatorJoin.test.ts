import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameType, RankedType } from "../../src/core/game/Game";
import { ClientMessage } from "../../src/core/Schemas";
import { createGameWireContext } from "../../src/core/ZbinWire";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";
import {
  cid,
  makeClient as harnessClient,
  makeGame as harnessGame,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// The upload the game hands its finished record to.
const archive = vi.fn(async () => {});

function makeClient(
  id: string,
  spectator = false,
  friends: string[] = [],
): Client {
  // The harness hands every client a distinct IP: the winner vote is weighted
  // by unique IP, so a shared one would collapse every electorate to a single
  // voter.
  return harnessClient({
    clientID: cid(id),
    persistentID: `${id}-pid`,
    publicId: `${id}-pub`,
    friends,
    spectator,
  });
}

describe("GameServer - spectators", () => {
  let logger: any;

  beforeEach(() => {
    vi.useFakeTimers();
    archive.mockReset();
    logger = mockLogger();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const makeGame = (maxPlayers?: number) =>
    harnessGame({
      log: logger,
      config: { gameType: GameType.Private, maxPlayers },
      deps: { archive },
    });

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
    const p1 = makeClient("p1");
    game.joinClient(p1);
    game.joinClient(makeClient("cast", true));
    startGame(game);
    const start = mockWsOf(p1)
      .sent()
      .find((m) => m.type === "start");
    expect(start?.type).toBe("start");
    if (start?.type !== "start") return;
    expect(start.gameStartInfo.players.map((p) => p.clientID)).toEqual([
      cid("p1"),
    ]);
  });

  it("still has to be on the allowlist when the lobby sets one", () => {
    // Taking no slot must not become a way around the allowlist.
    const game = harnessGame({
      log: logger,
      config: {
        gameType: GameType.Private,
        allowedPublicIds: ["p1-pub"],
      },
    });
    expect(game.joinClient(makeClient("cast", true))).toBe("not_allowlisted");
    expect(game.joinClient(makeClient("p1", true))).toBe("joined");
  });

  it("does not keep a ranked match alive on its own", () => {
    // 1v1 with one player and one spectator is a one-player game, so the
    // short-handed cancel has to see through the spectator.
    const game = harnessGame({
      log: logger,
      config: {
        gameType: GameType.Private,
        maxPlayers: 2,
        rankedType: RankedType.OneVOne,
      },
    });
    game.joinClient(makeClient("p1"));
    game.joinClient(makeClient("cast", true));
    expect(game.cancelShortHandedMatch()).toBe(true);
  });

  it.each(["intent", "winner", "live_stats", "hash", "report"])(
    "drops a %s sent by a spectator",
    async (type) => {
      // Taking no slot must not buy a way into the intent stream.
      const game = makeGame();
      const spies = {
        intent: vi.spyOn(game, "handleIntent"),
        winner: vi.spyOn(game as any, "handleWinner"),
        live_stats: vi.spyOn(game as any, "handleLiveStats"),
        report: vi.spyOn(game as any, "handleReport"),
      };
      const spectator = makeClient("cast", true);
      game.joinClient(spectator);
      const byType: Record<string, ClientMessage> = {
        intent: { type: "intent", intent: { type: "spawn", tile: 1 } },
        winner: { type: "winner", winner: undefined, allPlayersStats: {} },
        live_stats: { type: "live_stats", stats: { turn: 1, players: [] } },
        hash: { type: "hash", hash: 42, turnNumber: 1 },
        report: { type: "report", reported: cid("p1"), reason: "botting" },
      };
      await mockWsOf(spectator).emit(byType[type]);
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
    const handleIntent = vi.spyOn(game, "handleIntent");
    const player = makeClient("p1");
    game.joinClient(player);
    await mockWsOf(player).emit({
      type: "intent",
      intent: { type: "spawn", tile: 1 },
    });
    expect(handleIntent).toHaveBeenCalled();
  });

  it("joining after the start makes you a spectator, not a seatless player", () => {
    // The player list is frozen at start; a late joiner used to be admitted as a
    // player who could never spawn.
    const game = makeGame();
    startGame(game);
    const late = makeClient("late");
    expect(game.joinClient(late)).toBe("joined");
    expect(late.spectator).toBe(true);
  });

  it("does not put a spectator's disconnect into the turn log", () => {
    // mark_disconnected names a player in gameStartInfo; for a spectator it
    // refers to nobody, and it is kept in the archived record where readers take
    // it as a player having dropped. Joining records the (connected) status the
    // same way, so the first turn shows who the server marks.
    const game = makeGame();
    const spectator = makeClient("cast", true);
    game.joinClient(spectator);
    const p1 = makeClient("p1");
    game.joinClient(p1);
    startGame(game);
    vi.advanceTimersByTime(100);
    const ctx = createGameWireContext([{ clientID: cid("p1") }]);
    const turn = mockWsOf(p1)
      .sent(ctx)
      .find((m) => m.type === "turn");
    expect(turn?.type).toBe("turn");
    if (turn?.type !== "turn") return;
    const marked = turn.turn.intents
      .filter((i) => i.type === "mark_disconnected")
      .map((i) => i.clientID);
    expect(marked).not.toContain(cid("cast"));
    expect(marked).toContain(cid("p1"));
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
    const seen = game.gameInfo().clients?.find((c) => c.clientID === cid("p1"));
    expect(seen?.friends).toEqual([cid("p2")]);
  });

  it("does not make the winner vote unreachable", async () => {
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
    startGame(game);
    for (const p of players) {
      await mockWsOf(p).emit({
        type: "winner",
        winner: ["player", cid("p1")],
        allPlayersStats: {},
      });
    }
    // Consensus archives the game.
    expect(archive).toHaveBeenCalledOnce();
  });

  describe("switching between playing and watching", () => {
    const setSpectator = (_game: GameServer, c: Client, spectator: boolean) =>
      mockWsOf(c).emit({ type: "spectate", spectator });

    it("a spectator can take a free seat before the start", async () => {
      const game = makeGame(2);
      const c = makeClient("cast", true);
      game.joinClient(c);
      await setSpectator(game, c, false);
      expect(c.spectator).toBe(false);
      expect(
        game.gameInfo().clients?.find((x) => x.clientID === cid("cast"))
          ?.spectator,
      ).toBeUndefined();
    });

    it("a player can drop back to watching, freeing the seat", async () => {
      const game = makeGame(1);
      const p = makeClient("p1");
      game.joinClient(p);
      expect(game.joinClient(makeClient("p2"))).toBe("rejected");
      await setSpectator(game, p, true);
      expect(game.joinClient(makeClient("p2"))).toBe("joined");
    });

    it("cannot take a seat that would exceed the cap", async () => {
      const game = makeGame(1);
      game.joinClient(makeClient("p1"));
      const c = makeClient("cast", true);
      game.joinClient(c);
      await setSpectator(game, c, false);
      expect(c.spectator).toBe(true);
    });

    it("cannot take a seat the allowlist does not name them for", async () => {
      // The allowlist can gain entries AFTER someone is already in the lobby
      // (update_game_config replaces it), so being inside is not proof of a
      // seat. Without this, the toggle is a way past the allowlist the moment
      // anything admits a non-listed spectator.
      const game = harnessGame({
        log: logger,
        config: {
          gameType: GameType.Private,
          allowedPublicIds: ["p1-pub"],
        },
      });
      const listed = makeClient("p1", true);
      const unlisted = makeClient("cast", true);
      // Admit both while... the unlisted one cannot join an allowlisted lobby
      // today, so simulate the post-join list change: join first, then set it.
      const open = harnessGame({
        log: logger,
        config: { gameType: GameType.Private },
      });
      open.joinClient(unlisted);
      open.updateGameConfig({ allowedPublicIds: ["someone-else-pub"] });
      await setSpectator(open, unlisted, false);
      expect(unlisted.spectator).toBe(true);

      game.joinClient(listed);
      await setSpectator(game, listed, false);
      expect(listed.spectator).toBe(false);
    });

    it("cannot become a player once the game has started", async () => {
      // gameStartInfo.players is frozen, so a new player could never spawn.
      const game = makeGame();
      const c = makeClient("cast", true);
      game.joinClient(c);
      startGame(game);
      await setSpectator(game, c, false);
      expect(c.spectator).toBe(true);
    });

    it("shows a spectator the same lobby a player sees", () => {
      // Filtering spectators out of the roster emptied the list for anyone
      // watching a lobby they were alone in. They are listed and flagged
      // instead: the lobby view does not change for them.
      const game = makeGame();
      game.joinClient(makeClient("p1"));
      game.joinClient(makeClient("cast", true));
      const seen = game.gameInfo(cid("cast")).clients ?? [];
      expect(seen.map((c) => c.clientID)).toEqual([cid("p1"), cid("cast")]);
      expect(
        seen.find((c) => c.clientID === cid("p1"))?.spectator,
      ).toBeUndefined();
      expect(seen.find((c) => c.clientID === cid("cast"))?.spectator).toBe(
        true,
      );
    });
  });

  it("may join after the game has started", () => {
    // A caster arriving mid-game is the normal case; a late player already
    // gets the same treatment, so this only has to keep working.
    const game = makeGame();
    startGame(game);
    expect(game.joinClient(makeClient("cast", true))).toBe("joined");
  });
});
