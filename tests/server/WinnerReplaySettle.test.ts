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
import { winnerReplayMetrics } from "../../src/server/WinnerReplay";
import {
  cid,
  makeClient,
  makeGame,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// When the winner vote is disputed -- a vote named a different winner, or the
// game ended with no majority -- the server replays the game and archives the
// simulation's result instead of the vote's. Driven through the real game:
// votes arrive as winner messages, the replay is a stub the test resolves,
// and the outcome is whatever record the game hands to the archive.
describe("settling a disputed winner vote by replay", () => {
  const A = cid("alice");
  const B = cid("bob");
  const C = cid("carol");
  const D = cid("dave");
  const E = cid("erin");
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

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    archive = vi.fn(async () => {});
    log = mockLogger();
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

  function play(ids: string[]) {
    const game = makeGame({
      config: { gameType: GameType.Public },
      deps: { archive, replayWinner },
      log,
    });
    const clients = ids.map((clientID, i) =>
      makeClient({
        clientID,
        ip: `1.1.1.${i + 1}`,
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
        outcome: meta.outcome,
      }));
  // The one "winner stats agreement" line, and the level it was logged at.
  const agreementLog = () => {
    const lines = (["info", "warn"] as const).flatMap((level) =>
      log[level].mock.calls
        .filter(([msg]: [string]) => msg === "winner stats agreement")
        .map(([, meta]: [string, Record<string, unknown>]) => ({
          level,
          meta,
        })),
    );
    expect(lines).toHaveLength(1);
    return lines[0];
  };
  // Runs `fn` and returns how the outcome counters moved.
  const outcomesDuring = async (fn: () => Promise<void>) => {
    const before = { ...winnerReplayMetrics.outcomes };
    await fn();
    const after = winnerReplayMetrics.outcomes;
    return {
      agreed: after.agreed - before.agreed,
      overturned: after.overturned - before.overturned,
      failed: after.failed - before.failed,
    };
  };

  it("archives a unanimous vote without replaying", async () => {
    const { clients } = play([A, B]);
    await vote(clients[0], ["player", A]);
    await vote(clients[1], ["player", A]);

    expect(replayWinner).not.toHaveBeenCalled();
    expect(archived().map((r) => r.info.winner)).toEqual([["player", A]]);
  });

  it("replays a split vote and archives the simulation's winner and stats", async () => {
    const { game, clients } = play([A, B, C]);
    await vote(clients[2], ["player", C]);
    await vote(clients[0], ["player", A]);
    await vote(clients[1], ["player", A]);

    // A has a majority, but C disagreed: the record waits on the replay.
    expect(replayWinner).toHaveBeenCalledTimes(1);
    const [gameStart, turns] = replayWinner.mock.calls[0];
    expect(gameStart.gameID).toBe(game.id);
    expect(gameStart.players.map((p) => p.clientID)).toEqual([A, B, C]);
    expect(Array.isArray(turns)).toBe(true);
    expect(archive).not.toHaveBeenCalled();

    const stats = { [C]: { conquests: [3n] } } as AllPlayersStats;
    const counted = await outcomesDuring(async () => {
      resolveReplay({
        winner: ["player", C],
        allPlayersStats: stats,
        tick: 90,
      });
      await archivedOnce();
    });
    expect(counted).toEqual({ agreed: 0, overturned: 1, failed: 0 });
    // The majority was wrong; C, the lone dissenter, was right.
    expect(wrongVotes()).toEqual([
      { publicID: `pub-${A}`, voted: ["player", A], outcome: "overturned" },
      { publicID: `pub-${B}`, voted: ["player", A], outcome: "overturned" },
    ]);

    const [record] = archived();
    expect(record.info.winner).toEqual(["player", C]);
    expect(record.info.players.find((p) => p.clientID === C)?.stats).toEqual(
      stats[C],
    );
    // The server's own simulation produced the stats: they count as agreed.
    expect(record.info.statsAgreed).toBe(true);
  });

  it("replays a disputed vote at once, without holding the stats window", async () => {
    const { clients } = play([A, B, C, D, E]);
    await vote(clients[2], ["player", C]);
    // A's voters disagree on stats and E has yet to vote, which alone would
    // open the window.
    await vote(clients[0], ["player", A], {
      [A]: { conquests: [1n] },
    } as AllPlayersStats);
    await vote(clients[1], ["player", A], {
      [A]: { conquests: [2n] },
    } as AllPlayersStats);
    await vote(clients[3], ["player", A], {
      [A]: { conquests: [3n] },
    } as AllPlayersStats);

    expect(replayWinner).toHaveBeenCalledTimes(1);
    resolveReplay(null);
    await archivedOnce();
    // The fallback carries the vote's stats, unagreed.
    const [record] = archived();
    expect(record.info.winner).toEqual(["player", A]);
    expect(record.info.statsAgreed).toBe(false);
    expect(agreementLog()).toEqual({
      level: "warn",
      meta: expect.objectContaining({
        source: "vote",
        statsAgreed: false,
        statsAgreement: "split",
        versions: 3,
        archivedBackers: 1,
      }),
    });
  });

  it("logs the replay's stats as the agreed ones, not the vote's", async () => {
    const { clients } = play([A, B, C, D, E]);
    await vote(clients[2], ["player", C]);
    await vote(clients[0], ["player", A], {
      [A]: { conquests: [1n] },
    } as AllPlayersStats);
    await vote(clients[1], ["player", A], {
      [A]: { conquests: [2n] },
    } as AllPlayersStats);
    await vote(clients[3], ["player", A], {
      [A]: { conquests: [3n] },
    } as AllPlayersStats);

    resolveReplay({ winner: ["player", A], allPlayersStats: {}, tick: 90 });
    await archivedOnce();

    expect(archived()[0].info.statsAgreed).toBe(true);
    // The vote's split is still logged, but none of its versions was
    // archived, so it names no backers for the archived stats.
    const { level, meta } = agreementLog();
    expect(level).toBe("warn");
    expect(meta).toMatchObject({
      source: "replay",
      statsAgreed: true,
      statsAgreement: "split",
      versions: 3,
    });
    expect(meta).not.toHaveProperty("archivedBackers");
    expect(meta).not.toHaveProperty("agreed");
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
    expect(counted).toEqual({ agreed: 0, overturned: 0, failed: 1 });
    // Without a replay result nobody is proven wrong.
    expect(wrongVotes()).toEqual([]);
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
    expect(counted).toEqual({ agreed: 1, overturned: 0, failed: 0 });
    // The vote stood, but C claimed the win and was wrong.
    expect(wrongVotes()).toEqual([
      { publicID: `pub-${C}`, voted: ["player", C], outcome: "agreed" },
    ]);
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
    // No decided winner, so no vote split to report: only the record's.
    expect(agreementLog()).toEqual({
      level: "info",
      meta: { gameID: expect.any(String), source: "replay", statsAgreed: true },
    });
  });

  it("archives winnerless without replaying when nobody voted", async () => {
    const { game } = play([A, B]);
    await game.end();

    expect(replayWinner).not.toHaveBeenCalled();
    expect(archived().map((r) => r.info.winner)).toEqual([undefined]);
  });
});
