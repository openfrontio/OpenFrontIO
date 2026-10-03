import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { AllPlayersStats, PartialGameRecord } from "../../src/core/Schemas";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";
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
// winner alone, at the same vote. Driven through a real GameServer: votes
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
      agreed: true,
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
      agreed: true,
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

  it("decides the winner as before but does not agree when no stats version has a majority", async () => {
    const {
      clients: [forger, b],
    } = gameWith(["1.1.1.1", "2.2.2.2", "3.3.3.3"]);
    await vote(forger, forged);
    expect(archive).not.toHaveBeenCalled();
    // 2 of 3 decides the winner at this vote, exactly as before. The stats
    // are 1 and 1: neither is a majority.
    await vote(b, honest);

    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(false);
    // An even split falls back to the first vote's stats -- the record says
    // they are not agreed, so nothing scores them.
    expect(archivedStatsOfA()).toEqual(forged[A]);
    expect(agreementCall("warn")?.[1]).toMatchObject({
      statsAgreement: "split",
      agreed: false,
    });
  });

  it("archives the most-backed stats, unagreed, when they fall short of a majority", async () => {
    const {
      clients: [forger, b, c],
    } = gameWith(["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"]);
    await vote(forger, forged);
    await vote(b, honest);
    expect(archive).not.toHaveBeenCalled();
    // 3 of 4 decides the winner; the honest stats have 2 of 4.
    await vote(c, honest);

    expect(record().winner).toEqual(["player", A]);
    expect(record().statsAgreed).toBe(false);
    expect(archivedStatsOfA()).toEqual(honest[A]);
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
