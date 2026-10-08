import { GameType } from "@openfront/engine-api/game/GameTypes";
import { AllPlayersStats } from "@openfront/engine-api/Schemas";
import { PartialGameRecord } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/server/Client";
import { GameServer, STATS_VOTE_WINDOW_MS } from "../../src/server/GameServer";
import {
  cid,
  makeClient,
  makeGame,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// The archived record's per-player stats must be the version a majority of
// the electorate sent with the winning vote, and info.statsAgreed says whether
// there was one. The winner itself is decided exactly as before: on the
// winner alone, at the same vote. When the stats have no majority at that
// vote, the record waits up to STATS_VOTE_WINDOW_MS for the voters still to
// come. Driven through a real GameServer: votes
// arrive as winner messages on the clients' sockets, and the outcome is the
// record handed to the archive.
describe("winner vote stats agreement", () => {
  const A = cid("a");
  const B = cid("b");
  const C = cid("c");
  const D = cid("d");
  const honest: AllPlayersStats = { [A]: { finalTiles: 100n } };
  const forged: AllPlayersStats = { [A]: { finalTiles: 999n } };
  let archive: ReturnType<
    typeof vi.fn<(r: PartialGameRecord) => Promise<void>>
  >;
  let log: ReturnType<typeof mockLogger>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    archive = vi.fn(async () => {});
    log = mockLogger();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // One client per IP unless the IP is given twice.
  function gameWith(ips: string[]): { game: GameServer; clients: Client[] } {
    const game = makeGame({
      config: { gameType: GameType.Public },
      deps: { archive },
      log,
    });
    const ids = [A, B, C, D];
    const clients = ips.map((ip, i) => makeClient({ clientID: ids[i], ip }));
    clients.forEach((c) => game.joinClient(c));
    startGame(game);
    return { game, clients };
  }

  const vote = (client: Client, allPlayersStats: AllPlayersStats) =>
    mockWsOf(client).emit({
      type: "winner",
      winner: ["player", A],
      allPlayersStats,
    });
  const disconnect = (client: Client) => mockWsOf(client).trigger("close");

  const record = () => {
    expect(archive).toHaveBeenCalledTimes(1);
    return archive.mock.calls[0][0].info;
  };
  const archivedStatsOfA = () =>
    record().players.find((p) => p.clientID === A)?.stats;

  const agreementCall = (level: "info" | "warn") =>
    log[level].mock.calls.find(
      ([msg]: [string]) => msg === "winner stats agreement",
    );

  it("agrees when both players of a two-player game send the same stats", async () => {
    const {
      clients: [a, b],
    } = gameWith(["1.1.1.1", "2.2.2.2"]);
    await vote(a, honest);
    expect(archive).not.toHaveBeenCalled();
    await vote(b, honest);

    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(true);
    expect(archivedStatsOfA()).toEqual(honest[A]);
    expect(agreementCall("warn")).toBeUndefined();
    expect(agreementCall("info")?.[1]).toMatchObject({
      statsAgreement: "agreed",
      source: "vote",
      statsAgreed: true,
      voters: 2,
      versions: 1,
    });
  });

  it("agrees when three players send the same stats", async () => {
    const {
      clients: [a, b, c],
    } = gameWith(["1.1.1.1", "2.2.2.2", "3.3.3.3"]);
    await vote(a, honest);
    await vote(b, honest);
    // Decided at 2 of 3, as before; the third vote arrives too late to count.
    expect(archive).toHaveBeenCalledTimes(1);
    await vote(c, honest);

    expect(record().statsAgreed).toBe(true);
    expect(archivedStatsOfA()).toEqual(honest[A]);
  });

  it("archives the honest majority's stats over a forger who voted first", async () => {
    // The forger shares an IP with an honest player (a household, say). The
    // winner needs both IPs; so do the honest stats, and they have them.
    const {
      clients: [forger, b, c],
    } = gameWith(["1.1.1.1", "1.1.1.1", "2.2.2.2"]);
    await vote(forger, forged);
    await vote(b, honest);
    expect(archive).not.toHaveBeenCalled();
    await vote(c, honest);

    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(true);
    expect(archivedStatsOfA()).toEqual(honest[A]);
    // Still logged as a split, so forgeries stay visible.
    expect(agreementCall("warn")?.[1]).toMatchObject({
      statsAgreement: "split",
      source: "vote",
      statsAgreed: true,
      voters: 2,
      versions: 2,
      archivedBackers: 2,
      topBackers: 2,
    });
  });

  it("archives the honest majority's stats when the forger voted first and left", async () => {
    const {
      clients: [forger, b, c],
    } = gameWith(["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"]);
    await vote(forger, forged);
    await vote(b, honest);
    await disconnect(forger);
    expect(archive).not.toHaveBeenCalled();
    // 3 of the 3 IPs still playing voted for A (the departed forger's vote
    // still counts here, as it always has); 2 of 3 sent the honest stats.
    await vote(c, honest);

    expect(record().statsAgreed).toBe(true);
    expect(archivedStatsOfA()).toEqual(honest[A]);
  });

  // A forger inside the deciding majority of three: the winner is decided at
  // the second vote with the stats split 1-1, and the third player has not
  // voted yet.
  async function forgerInsideMajority() {
    const { game, clients } = gameWith(["1.1.1.1", "2.2.2.2", "3.3.3.3"]);
    const [forger, b] = clients;
    await vote(forger, forged);
    await vote(b, honest);
    return { game, clients };
  }

  const decidedLog = () =>
    log.info.mock.calls.filter(([msg]: [string]) =>
      msg.startsWith("Winner determined by"),
    );

  it("decides the winner at the same vote, and holds only the record for late stats votes", async () => {
    await forgerInsideMajority();

    // Decided exactly as before: at 2 of 3, at this vote.
    expect(decidedLog()).toHaveLength(1);
    expect(decidedLog()[0][0]).toBe("Winner determined by 2/3 active IPs");
    // Only the record waits.
    expect(archive).not.toHaveBeenCalled();
  });

  it("archives the honest stats, agreed, when a late honest vote lands in the window", async () => {
    const {
      clients: [, , c],
    } = await forgerInsideMajority();
    vi.advanceTimersByTime(STATS_VOTE_WINDOW_MS - 1_000);
    expect(archive).not.toHaveBeenCalled();

    await vote(c, honest);

    // Archived at that vote, without waiting out the window.
    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(true);
    expect(archivedStatsOfA()).toEqual(honest[A]);
    expect(agreementCall("warn")?.[1]).toMatchObject({
      statsAgreement: "split",
      source: "vote",
      statsAgreed: true,
      voters: 3,
      versions: 2,
      archivedBackers: 2,
    });

    // The timer it cancelled never archives again.
    vi.advanceTimersByTime(STATS_VOTE_WINDOW_MS * 2);
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it("archives once, unagreed, when the window runs out", async () => {
    const {
      game,
      clients: [, , c],
    } = await forgerInsideMajority();
    vi.advanceTimersByTime(STATS_VOTE_WINDOW_MS - 1);
    expect(archive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(false);
    // An even split falls back to the first vote's stats -- the record says
    // they are not agreed, so nothing scores them.
    expect(archivedStatsOfA()).toEqual(forged[A]);
    expect(agreementCall("warn")?.[1]).toMatchObject({
      statsAgreement: "split",
      source: "vote",
      statsAgreed: false,
    });

    // Votes after archiving are rejected, and ending the game does not
    // archive it a second time.
    await vote(c, honest);
    await game.end();
    vi.advanceTimersByTime(STATS_VOTE_WINDOW_MS * 2);
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it("archives the most-backed stats, unagreed, when the window runs out short of a majority", async () => {
    const {
      clients: [forger, b, c],
    } = gameWith(["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"]);
    await vote(forger, forged);
    await vote(b, honest);
    // 3 of 4 decides the winner; the honest stats have 2 of 4.
    await vote(c, honest);
    expect(archive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(STATS_VOTE_WINDOW_MS);

    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(false);
    expect(archivedStatsOfA()).toEqual(honest[A]);
  });

  it("archives at once, without a window, when everyone has already voted", async () => {
    const {
      clients: [forger, b],
    } = gameWith(["1.1.1.1", "2.2.2.2"]);
    await vote(forger, forged);
    // Both voted and the stats split 1-1: nobody is left to break the tie.
    await vote(b, honest);

    expect(record().statsAgreed).toBe(false);
    vi.advanceTimersByTime(STATS_VOTE_WINDOW_MS * 2);
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it("counts an earlier vote for another winner as having voted", async () => {
    const {
      clients: [forger, b, c],
    } = gameWith(["1.1.1.1", "2.2.2.2", "3.3.3.3"]);
    await mockWsOf(c).emit({
      type: "winner",
      winner: ["player", C],
      allPlayersStats: honest,
    });
    await vote(forger, forged);
    await vote(b, honest);

    // Decided 2 of 3; everyone has voted, so no window.
    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(false);
  });

  it("gives a late vote for another winner no say in the stats", async () => {
    const {
      clients: [, , c],
    } = await forgerInsideMajority();
    await mockWsOf(c).emit({
      type: "winner",
      winner: ["player", C],
      allPlayersStats: honest,
    });

    // c has voted, so everyone has: archived at once, still split.
    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(false);
  });

  it("keeps a departed voter in the electorate when they leave in the window", async () => {
    const {
      clients: [forger, , c],
    } = await forgerInsideMajority();
    // The forger leaves: the electorate is still the three IPs at the
    // decision, so the honest stats hold 1 of 3 -- not yet.
    await disconnect(forger);
    expect(archive).not.toHaveBeenCalled();
    await vote(c, honest);

    expect(record().statsAgreed).toBe(true);
    expect(archivedStatsOfA()).toEqual(honest[A]);
  });

  it("never lets honest voters leaving hand the forged stats a majority", async () => {
    const {
      clients: [, b, c],
    } = await forgerInsideMajority();
    // The honest voter closes the win screen, then the last player leaves
    // without voting. Among the one player left the forged stats would be
    // 1 of 1; among the electorate at the decision they are 1 of 3.
    await disconnect(b);
    expect(archive).not.toHaveBeenCalled();
    await disconnect(c);

    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(false);
  });

  it("archives at once when the last player yet to vote leaves in the window", async () => {
    const {
      clients: [, , c],
    } = await forgerInsideMajority();
    await disconnect(c);

    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(false);
    vi.advanceTimersByTime(STATS_VOTE_WINDOW_MS * 2);
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it("archives an open record when the game ends, before it can be dropped", async () => {
    const { game } = await forgerInsideMajority();
    expect(archive).not.toHaveBeenCalled();

    // GameManager drops a game right after end(); the record must be out by
    // then, counted against the roster as it stood.
    await game.end();
    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(false);
    expect(log.info.mock.calls.map(([msg]: [string]) => msg)).toContain(
      "game already archived",
    );

    vi.advanceTimersByTime(STATS_VOTE_WINDOW_MS * 2);
    await game.end();
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it("does not hold the record of a game whose stats agree at the decision", async () => {
    const {
      clients: [a, b],
    } = gameWith(["1.1.1.1", "2.2.2.2", "3.3.3.3"]);
    await vote(a, honest);
    await vote(b, honest);
    // Archived at the deciding vote, as before the window existed.
    expect(record().statsAgreed).toBe(true);
    expect(
      log.info.mock.calls.some(
        ([msg]: [string]) =>
          msg === "winner decided, stats open for late votes",
      ),
    ).toBe(false);
  });

  it("agrees with the lone voter of a one-player game, as the winner vote does", async () => {
    const {
      clients: [a],
    } = gameWith(["1.1.1.1"]);
    await vote(a, honest);

    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(true);
    expect(archivedStatsOfA()).toEqual(honest[A]);
  });

  it("agrees with the remaining voter once the other player leaves without voting", async () => {
    const {
      clients: [a, b],
    } = gameWith(["1.1.1.1", "2.2.2.2"]);
    await vote(a, honest);
    expect(archive).not.toHaveBeenCalled();
    // The re-tally decides the winner on 1 of 1; the stats follow.
    await disconnect(b);

    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(true);
  });

  it("does not agree when the game ends without a decided winner", async () => {
    const {
      game,
      clients: [a],
    } = gameWith(["1.1.1.1", "2.2.2.2"]);
    await vote(a, honest);
    await game.end();

    expect(record().winner).toBeUndefined();
    expect(record().statsAgreed).toBe(false);
    expect(archivedStatsOfA()).toBeUndefined();
    expect(agreementCall("info")).toBeUndefined();
    expect(agreementCall("warn")).toBeUndefined();
  });
});
