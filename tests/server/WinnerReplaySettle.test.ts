import { GameType } from "@openfront/engine-api/game/GameTypes";
import {
  AllPlayersStats,
  GameStartInfo,
  Turn,
  Winner,
} from "@openfront/engine-api/Schemas";
import type { ReplayedWinner } from "@openfront/engine/WinnerReplay";
import { PartialGameRecord } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/server/Client";
import {
  LONE_VOTER_REPLAY_CAP,
  winnerReplayMetrics,
} from "../../src/server/WinnerReplay";
import {
  cid,
  makeClient,
  makeGame,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// When the winner vote is disputed -- a vote named a different winner or sent
// different stats, or the game ended with no majority -- or a single IP
// decided it, the server replays the game and archives the simulation's
// result instead of the vote's. The record's statsAgreed says whether its
// winner and stats were checked, by two or more IPs or by the replay. A
// one-IP vote skips the replay, unconfirmed, when the queue is full. Driven
// through the real game: votes arrive as winner messages, the replay is a
// stub the test resolves, and the outcome is whatever record the game hands
// to the archive.
describe("settling a disputed winner vote by replay", () => {
  const A = cid("alice");
  const B = cid("bob");
  const C = cid("carol");
  let archive: ReturnType<
    typeof vi.fn<(r: PartialGameRecord) => Promise<void>>
  >;
  let log: ReturnType<typeof mockLogger>;
  let resolveReplay: (r: ReplayedWinner | null) => void;
  let replayWinner: ReturnType<
    typeof vi.fn<
      (g: GameStartInfo, t: Turn[]) => Promise<ReplayedWinner | null>
    >
  >;
  // Replays already waiting or running on the worker, as the game sees it.
  let pending: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    archive = vi.fn(async () => {});
    log = mockLogger();
    pending = 0;
    replayWinner = vi.fn(
      () =>
        new Promise<ReplayedWinner | null>((resolve) => {
          resolveReplay = resolve;
        }),
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // `ips` defaults to one IP per client.
  function play(ids: string[], ips?: string[]) {
    const game = makeGame({
      config: { gameType: GameType.Public },
      deps: { archive, replayWinner, replayPending: () => pending },
      log,
    });
    const clients = ids.map((clientID, i) =>
      makeClient({
        clientID,
        ip: ips?.[i] ?? `1.1.1.${i + 1}`,
        publicId: `pub-${clientID}`,
      }),
    );
    clients.forEach((c) => game.joinClient(c));
    startGame(game);
    return { game, clients };
  }

  const vote = (client: Client, winner: Winner, stats: AllPlayersStats = {}) =>
    mockWsOf(client).emit({ type: "winner", winner, allPlayersStats: stats });
  const archived = () => archive.mock.calls.map(([record]) => record);
  const archivedOnce = () =>
    vi.waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
  // The "wrong winner vote" lines: who voted wrong, for what.
  const wrongVotes = () =>
    log.warn.mock.calls
      .filter(([msg]: [string]) => msg === "wrong winner vote")
      .map(([, meta]: [string, Record<string, unknown>]) => ({
        publicID: meta.publicID,
        voted: meta.voted,
        wrongStats: meta.wrongStats,
        outcome: meta.outcome,
      }));
  // Runs `fn` and returns how the outcome counters moved.
  const outcomesDuring = async (fn: () => Promise<void>) => {
    const before = { ...winnerReplayMetrics.outcomes };
    await fn();
    const after = winnerReplayMetrics.outcomes;
    return {
      agreed: after.agreed - before.agreed,
      overturned: after.overturned - before.overturned,
      failed: after.failed - before.failed,
      skipped: after.skipped - before.skipped,
    };
  };

  it("archives a unanimous vote without replaying", async () => {
    const { clients } = play([A, B]);
    await vote(clients[0], ["player", A]);
    await vote(clients[1], ["player", A]);

    expect(replayWinner).not.toHaveBeenCalled();
    expect(archived().map((r) => r.info.winner)).toEqual([["player", A]]);
    expect(archived()[0].info.statsAgreed).toBe(true);
  });

  it("replays a split vote and archives the simulation's winner and stats", async () => {
    const stats = { [C]: { conquests: [3n] } } as AllPlayersStats;
    const { game, clients } = play([A, B, C]);
    await vote(clients[2], ["player", C], stats);
    await vote(clients[0], ["player", A]);
    await vote(clients[1], ["player", A]);

    // A has a majority, but C disagreed: the record waits on the replay.
    expect(replayWinner).toHaveBeenCalledTimes(1);
    const [gameStart, turns] = replayWinner.mock.calls[0];
    expect(gameStart.gameID).toBe(game.id);
    expect(gameStart.players.map((p) => p.clientID)).toEqual([A, B, C]);
    expect(Array.isArray(turns)).toBe(true);
    expect(archive).not.toHaveBeenCalled();

    const counted = await outcomesDuring(async () => {
      resolveReplay({
        winner: ["player", C],
        allPlayersStats: stats,
        tick: 90,
      });
      await archivedOnce();
    });
    expect(counted).toEqual({
      agreed: 0,
      overturned: 1,
      failed: 0,
      skipped: 0,
    });
    // The majority was wrong; C, the lone dissenter, was right.
    expect(wrongVotes()).toEqual([
      {
        publicID: `pub-${A}`,
        voted: ["player", A],
        wrongStats: false,
        outcome: "overturned",
      },
      {
        publicID: `pub-${B}`,
        voted: ["player", A],
        wrongStats: false,
        outcome: "overturned",
      },
    ]);

    const [record] = archived();
    expect(record.info.winner).toEqual(["player", C]);
    expect(record.info.players.find((p) => p.clientID === C)?.stats).toEqual(
      stats[C],
    );
    // The replay supplied the winner and stats.
    expect(record.info.statsAgreed).toBe(true);
  });

  it("falls back to the vote's winner when the replay fails", async () => {
    const { clients } = play([A, B, C]);
    await vote(clients[2], ["player", C]);
    await vote(clients[0], ["player", A]);
    await vote(clients[1], ["player", A]);

    const counted = await outcomesDuring(async () => {
      resolveReplay(null);
      await archivedOnce();
    });

    expect(archived()[0].info.winner).toEqual(["player", A]);
    expect(counted).toEqual({
      agreed: 0,
      overturned: 0,
      failed: 1,
      skipped: 0,
    });
    // Without a replay result nobody is proven wrong.
    expect(wrongVotes()).toEqual([]);
    // A and B, two IPs, sent the archived winner and stats.
    expect(archived()[0].info.statsAgreed).toBe(true);
  });

  it("counts a replay that confirms the vote as agreed", async () => {
    const { clients } = play([A, B, C]);
    await vote(clients[2], ["player", C]);
    await vote(clients[0], ["player", A]);
    await vote(clients[1], ["player", A]);

    const counted = await outcomesDuring(async () => {
      resolveReplay({ winner: ["player", A], allPlayersStats: {}, tick: 90 });
      await archivedOnce();
    });

    expect(archived()[0].info.winner).toEqual(["player", A]);
    expect(counted).toEqual({
      agreed: 1,
      overturned: 0,
      failed: 0,
      skipped: 0,
    });
    // The vote stood, but C claimed the win and was wrong.
    expect(wrongVotes()).toEqual([
      {
        publicID: `pub-${C}`,
        voted: ["player", C],
        wrongStats: false,
        outcome: "agreed",
      },
    ]);
    expect(archived()[0].info.statsAgreed).toBe(true);
  });

  it("replays when a voter names the right winner with forged stats", async () => {
    const honest = { [A]: { finalTiles: 100n } } as AllPlayersStats;
    const forged = { [A]: { finalTiles: 999n } } as AllPlayersStats;
    const { clients } = play([A, B, C]);
    // The forger votes first: the record must not carry their stats.
    await vote(clients[0], ["player", A], forged);
    await vote(clients[1], ["player", A], honest);
    await vote(clients[2], ["player", A], honest);

    expect(replayWinner).toHaveBeenCalledTimes(1);
    const counted = await outcomesDuring(async () => {
      resolveReplay({
        winner: ["player", A],
        allPlayersStats: honest,
        tick: 90,
      });
      await archivedOnce();
    });

    expect(counted).toEqual({
      agreed: 1,
      overturned: 0,
      failed: 0,
      skipped: 0,
    });
    expect(wrongVotes()).toEqual([
      {
        publicID: `pub-${A}`,
        voted: ["player", A],
        wrongStats: true,
        outcome: "agreed",
      },
    ]);
    const [record] = archived();
    expect(record.info.players.find((p) => p.clientID === A)?.stats).toEqual(
      honest[A],
    );
    expect(record.info.statsAgreed).toBe(true);
  });

  it("replays a game that ends with no majority", async () => {
    const { game, clients } = play([A, B]);
    await vote(clients[0], ["player", A]);
    await vote(clients[1], ["player", B]);
    expect(replayWinner).not.toHaveBeenCalled();

    await game.end();
    expect(replayWinner).toHaveBeenCalledTimes(1);

    resolveReplay({ winner: ["player", B], allPlayersStats: {}, tick: 90 });
    await archivedOnce();
    expect(archived()[0].info.winner).toEqual(["player", B]);
    expect(archived()[0].info.statsAgreed).toBe(true);
  });

  it("archives winnerless without replaying when nobody voted", async () => {
    const { game } = play([A, B]);
    await game.end();

    expect(replayWinner).not.toHaveBeenCalled();
    expect(archived().map((r) => r.info.winner)).toEqual([undefined]);
    expect(archived()[0].info.statsAgreed).toBe(false);
  });

  const disconnect = (client: Client) => mockWsOf(client).trigger("close");
  const warned = (msg: string) =>
    log.warn.mock.calls
      .filter(([m]: [string]) => m === msg)
      .map(([, meta]: [string, Record<string, unknown>]) => meta);

  it("replays a vote decided by a lone IP and archives the replay's result", async () => {
    const claimed = { [A]: { finalTiles: 100n } } as AllPlayersStats;
    const simulated = { [A]: { finalTiles: 80n } } as AllPlayersStats;
    const { game, clients } = play([A, B]);
    await vote(clients[0], ["player", A], claimed);
    // The loser leaves without voting: A's vote decides alone.
    await disconnect(clients[1]);

    expect(replayWinner).toHaveBeenCalledTimes(1);
    expect(warned("winner vote decided by one IP, replaying game")).toEqual([
      expect.objectContaining({ candidates: 1, backers: 1 }),
    ]);
    // Ending the game meanwhile leaves the record to the replay.
    await game.end();
    expect(archive).not.toHaveBeenCalled();

    const counted = await outcomesDuring(async () => {
      resolveReplay({
        winner: ["player", A],
        allPlayersStats: simulated,
        tick: 90,
      });
      await archivedOnce();
    });
    expect(counted).toEqual({
      agreed: 0,
      overturned: 1,
      failed: 0,
      skipped: 0,
    });
    expect(log.warn).toHaveBeenCalledWith(
      "winner replay result",
      expect.objectContaining({ reason: "lone voter", agrees: false }),
    );
    expect(wrongVotes()).toEqual([
      {
        publicID: `pub-${A}`,
        voted: ["player", A],
        wrongStats: true,
        outcome: "overturned",
      },
    ]);

    const [record] = archived();
    expect(record.info.winner).toEqual(["player", A]);
    expect(record.info.players.find((p) => p.clientID === A)?.stats).toEqual(
      simulated[A],
    );
    expect(record.info.statsAgreed).toBe(true);
  });

  it("falls back to a lone voter's result, not agreed, when its replay fails", async () => {
    const claimed = { [A]: { finalTiles: 100n } } as AllPlayersStats;
    const { clients } = play([A, B]);
    await vote(clients[0], ["player", A], claimed);
    await disconnect(clients[1]);

    const counted = await outcomesDuring(async () => {
      resolveReplay(null);
      await archivedOnce();
    });
    expect(counted).toEqual({
      agreed: 0,
      overturned: 0,
      failed: 1,
      skipped: 0,
    });
    expect(warned("winner replay failed, archiving the vote")).toEqual([
      expect.objectContaining({
        reason: "lone voter",
        backers: 1,
        statsAgreed: false,
      }),
    ]);

    const [record] = archived();
    expect(record.info.winner).toEqual(["player", A]);
    expect(record.info.players.find((p) => p.clientID === A)?.stats).toEqual(
      claimed[A],
    );
    expect(record.info.statsAgreed).toBe(false);
  });

  it("counts IPs, not clients: two clients on one IP are a lone voter", async () => {
    const { clients } = play([A, B], ["9.9.9.9", "9.9.9.9"]);
    await vote(clients[0], ["player", A]);

    expect(replayWinner).toHaveBeenCalledTimes(1);
    expect(archive).not.toHaveBeenCalled();
    resolveReplay(null);
    await archivedOnce();
    expect(archived()[0].info.statsAgreed).toBe(false);
  });

  it("archives a lone voter's result unconfirmed, without replaying, when the replay queue is full", async () => {
    pending = LONE_VOTER_REPLAY_CAP;
    const claimed = { [A]: { finalTiles: 100n } } as AllPlayersStats;
    const { clients } = play([A, B]);

    const counted = await outcomesDuring(async () => {
      await vote(clients[0], ["player", A], claimed);
      await disconnect(clients[1]);
    });

    expect(replayWinner).not.toHaveBeenCalled();
    expect(counted).toEqual({
      agreed: 0,
      overturned: 0,
      failed: 0,
      skipped: 1,
    });
    expect(
      warned("winner replay queue full, archiving the lone vote unconfirmed"),
    ).toEqual([
      expect.objectContaining({
        pending: LONE_VOTER_REPLAY_CAP,
        cap: LONE_VOTER_REPLAY_CAP,
      }),
    ]);
    const [record] = archived();
    expect(archived()).toHaveLength(1);
    expect(record.info.winner).toEqual(["player", A]);
    expect(record.info.players.find((p) => p.clientID === A)?.stats).toEqual(
      claimed[A],
    );
    expect(record.info.statsAgreed).toBe(false);
  });

  it("still replays a lone voter while the replay queue is below the cap", async () => {
    pending = LONE_VOTER_REPLAY_CAP - 1;
    const { clients } = play([A, B]);
    await vote(clients[0], ["player", A]);
    await disconnect(clients[1]);

    expect(replayWinner).toHaveBeenCalledTimes(1);
    expect(archive).not.toHaveBeenCalled();
    resolveReplay({ winner: ["player", A], allPlayersStats: {}, tick: 90 });
    await archivedOnce();
    expect(archived()[0].info.statsAgreed).toBe(true);
  });

  it("still replays a disputed vote when the replay queue is full", async () => {
    pending = LONE_VOTER_REPLAY_CAP;
    const { clients } = play([A, B, C]);
    await vote(clients[2], ["player", C]);
    await vote(clients[0], ["player", A]);
    await vote(clients[1], ["player", A]);

    expect(replayWinner).toHaveBeenCalledTimes(1);
    expect(archive).not.toHaveBeenCalled();
    const counted = await outcomesDuring(async () => {
      resolveReplay({ winner: ["player", A], allPlayersStats: {}, tick: 90 });
      await archivedOnce();
    });
    expect(counted).toEqual({
      agreed: 1,
      overturned: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("counts an IP that sent the decided vote and then left", async () => {
    const D = cid("dave");
    const { clients } = play([A, B, C, D]);
    await vote(clients[0], ["player", A]);
    await vote(clients[1], ["player", A]);
    // 2 of 4 is no majority. B, C and D leave; A decides among the active
    // IPs alone, but B sent the same winner and stats before leaving.
    await disconnect(clients[1]);
    await disconnect(clients[2]);
    expect(archive).not.toHaveBeenCalled();
    await disconnect(clients[3]);

    expect(replayWinner).not.toHaveBeenCalled();
    expect(archived().map((r) => r.info.winner)).toEqual([["player", A]]);
    expect(archived()[0].info.statsAgreed).toBe(true);
  });

  it("archives winnerless, not agreed, when a no-majority replay fails", async () => {
    const { game, clients } = play([A, B]);
    await vote(clients[0], ["player", A]);
    await vote(clients[1], ["player", B]);
    await game.end();

    resolveReplay(null);
    await archivedOnce();
    expect(archived()[0].info.winner).toBeUndefined();
    expect(archived()[0].info.statsAgreed).toBe(false);
    expect(warned("winner replay failed, archiving the vote")).toEqual([
      expect.objectContaining({ reason: "disputed", statsAgreed: false }),
    ]);
  });

  it("tags a single candidate short of a majority as no majority", async () => {
    const { game, clients } = play([A, B, C]);
    await vote(clients[0], ["player", A]);
    await game.end();

    expect(warned("winner vote has no majority, replaying game")).toHaveLength(
      1,
    );
    resolveReplay(null);
    await archivedOnce();
    expect(warned("winner replay failed, archiving the vote")).toEqual([
      expect.objectContaining({ reason: "no majority", statsAgreed: false }),
    ]);
  });

  it("archives the vote's result when the replay throws", async () => {
    replayWinner.mockImplementation(() =>
      Promise.reject(new Error("replay crashed")),
    );
    const { clients } = play([A, B, C]);
    await vote(clients[2], ["player", C]);
    await vote(clients[0], ["player", A]);
    const counted = await outcomesDuring(async () => {
      await vote(clients[1], ["player", A]);
      await archivedOnce();
    });

    expect(archived()[0].info.winner).toEqual(["player", A]);
    expect(archived()[0].info.statsAgreed).toBe(true);
    expect(counted).toEqual({
      agreed: 0,
      overturned: 0,
      failed: 1,
      skipped: 0,
    });
  });

  it("ignores winner votes sent before the game has started", async () => {
    const game = makeGame({
      config: { gameType: GameType.Public },
      deps: { archive, replayWinner },
      log,
    });
    const clients = [A, B].map((clientID, i) =>
      makeClient({
        clientID,
        ip: `1.1.1.${i + 1}`,
        publicId: `pub-${clientID}`,
      }),
    );
    clients.forEach((c) => game.joinClient(c));
    // A vote from the lobby names another winner; it must not count later.
    // Called directly: in this harness a lobby frame doesn't decode before
    // start, so the handler's own guard is what is under test.
    (
      game as unknown as {
        handleWinner(c: Client, m: unknown): void;
      }
    ).handleWinner(clients[0], {
      type: "winner",
      winner: ["player", B],
      allPlayersStats: {},
    });
    expect(clients[0].reportedVote).toBeNull();
    expect(archive).not.toHaveBeenCalled();

    startGame(game);
    await vote(clients[0], ["player", A]);
    await vote(clients[1], ["player", A]);
    // Unanimous once started: no dispute, so no replay.
    expect(replayWinner).not.toHaveBeenCalled();
    expect(archived().map((r) => r.info.winner)).toEqual([["player", A]]);
    expect(archived()[0].info.statsAgreed).toBe(true);
  });
});
