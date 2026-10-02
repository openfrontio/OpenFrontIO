import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { AllPlayersStats, PartialGameRecord } from "../../src/core/Schemas";
import { Client } from "../../src/server/Client";
import {
  cid,
  makeClient,
  makeGame,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Log-only groundwork for putting per-player stats under the winner vote:
// the vote still decides on the winner alone and archives the first voter's
// stats, but the game now logs whether the voters agreed on those stats. The
// log line is what tells us whether keying the vote on stats is safe.
describe("winner vote stats agreement logging", () => {
  const A = cid("a");
  const B = cid("b");
  const C = cid("c");
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

  function threePlayerGame() {
    const game = makeGame({
      config: { gameType: GameType.Public },
      deps: { archive },
      log,
    });
    const clients = [
      makeClient({ clientID: A, ip: "1.1.1.1" }),
      makeClient({ clientID: B, ip: "2.2.2.2" }),
      makeClient({ clientID: C, ip: "3.3.3.3" }),
    ];
    clients.forEach((c) => game.joinClient(c));
    startGame(game);
    return clients;
  }

  const vote = (client: Client, allPlayersStats: AllPlayersStats) =>
    mockWsOf(client).emit({
      type: "winner",
      winner: ["player", A],
      allPlayersStats,
    });

  const agreementCall = (level: "info" | "warn") =>
    log[level].mock.calls.find(
      ([msg]: [string]) => msg === "winner stats agreement",
    );

  it("logs agreement at info when the voters sent the same stats", async () => {
    const [a, b] = threePlayerGame();
    await vote(a, honest);
    await vote(b, honest);

    expect(archive).toHaveBeenCalledTimes(1);
    expect(agreementCall("warn")).toBeUndefined();
    expect(agreementCall("info")?.[1]).toMatchObject({
      statsAgreement: "agreed",
      voters: 2,
      versions: 1,
    });
  });

  it("logs a split at warn, and still archives the first voter's stats", async () => {
    const [a, b, c] = threePlayerGame();
    await vote(a, forged);
    await vote(b, honest);
    await vote(c, honest);

    // Log-only: the archived record is exactly what it was before.
    expect(archive).toHaveBeenCalledTimes(1);
    const record = archive.mock.calls[0][0];
    expect(record.info.players.find((p) => p.clientID === A)?.stats).toEqual(
      forged[A],
    );

    expect(agreementCall("warn")?.[1]).toMatchObject({
      statsAgreement: "split",
      voters: 2,
      versions: 2,
      archivedBackers: 1,
      topBackers: 1,
    });
  });
});
