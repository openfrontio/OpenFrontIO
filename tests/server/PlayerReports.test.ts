import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { PartialGameRecord } from "../../src/core/Schemas";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Player reports: filed over the socket during the game, kept out of the
// turn log, and handed to the API once as info.reports of the archived
// record (the moderation tools read them from there).

describe("player reports", () => {
  let archive: ReturnType<
    typeof vi.fn<(r: PartialGameRecord) => Promise<void>>
  >;

  beforeEach(() => {
    vi.useFakeTimers();
    archive = vi.fn(async () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const ALICE = cid("alice");
  const BOB = cid("bob");
  const CAROL = cid("carol");

  function makeThreePlayerGame() {
    const game = makeGame({
      config: { gameType: GameType.Public, maxPlayers: 3 },
      deps: { archive },
    });
    const alice = makeClient({ clientID: ALICE, ip: "1.1.1.1" });
    const bob = makeClient({ clientID: BOB, ip: "2.2.2.2" });
    const carol = makeClient({ clientID: CAROL, ip: "3.3.3.3" });
    game.joinClient(alice);
    game.joinClient(bob);
    game.joinClient(carol);
    return { game, alice, bob, carol };
  }

  async function finish(...clients: ReturnType<typeof makeClient>[]) {
    for (const c of clients) {
      await mockWsOf(c).emit({
        type: "winner",
        winner: ["player", ALICE],
        allPlayersStats: {},
      });
    }
    expect(archive).toHaveBeenCalledTimes(1);
    return archive.mock.calls[0][0];
  }

  it("archives one report per (reporter, reported) pair, keeping the first reason", async () => {
    const { game, alice, bob, carol } = makeThreePlayerGame();
    startGame(game);

    await mockWsOf(alice).emit({
      type: "report",
      reported: BOB,
      reason: "botting",
    });
    // Same pair again: dropped, whatever the reason.
    await mockWsOf(alice).emit({
      type: "report",
      reported: BOB,
      reason: "teaming",
    });
    await mockWsOf(alice).emit({
      type: "report",
      reported: CAROL,
      reason: "griefing",
    });
    await mockWsOf(bob).emit({
      type: "report",
      reported: ALICE,
      reason: "inappropriate_username",
    });

    const record = await finish(alice, bob, carol);
    expect(record.info.reports).toEqual([
      { reportedBy: ALICE, reported: BOB, reason: "botting" },
      { reportedBy: ALICE, reported: CAROL, reason: "griefing" },
      { reportedBy: BOB, reported: ALICE, reason: "inappropriate_username" },
    ]);
    // Reports are not intents: nothing about them reaches the turn log.
    expect(JSON.stringify(record.turns)).not.toContain("report");
  });

  it("drops self-reports and reports naming someone not in the game", async () => {
    const { game, alice, bob, carol } = makeThreePlayerGame();
    startGame(game);

    await mockWsOf(alice).emit({
      type: "report",
      reported: ALICE,
      reason: "botting",
    });
    await mockWsOf(alice).emit({
      type: "report",
      reported: cid("stranger"),
      reason: "botting",
    });

    const record = await finish(alice, bob, carol);
    expect(record.info.reports).toEqual([]);
  });

  it("refuses reports filed after the winner vote resolved", async () => {
    // The record went to the API when the vote resolved; a later report
    // would sit on the server with nowhere to go.
    const { game, alice, bob, carol } = makeThreePlayerGame();
    startGame(game);
    const record = await finish(alice, bob, carol);
    expect(record.info.reports).toEqual([]);

    await mockWsOf(alice).emit({
      type: "report",
      reported: BOB,
      reason: "griefing",
    });
    expect((game as any).reports.size).toBe(0);
  });

  it("ignores reports filed before the game starts", async () => {
    // The player list is only frozen at start; the API needs both sides in
    // info.players.
    const { game, alice, bob, carol } = makeThreePlayerGame();

    await mockWsOf(alice).emit({
      type: "report",
      reported: BOB,
      reason: "teaming",
    });
    startGame(game);

    const record = await finish(alice, bob, carol);
    expect(record.info.reports).toEqual([]);
  });
});
