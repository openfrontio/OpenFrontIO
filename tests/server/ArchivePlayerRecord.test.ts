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

// What the game writes into the record it archives, driven through real
// joins and starts and read off the injected archive.

// Lets the fetchTribes .then/.catch chain settle.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("archived game records", () => {
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

  const archived = () => archive.mock.calls[0][0];

  it("preserves simulation inputs (teamIndex, friends, isLobbyCreator) so replays stay in sync", async () => {
    // Matchmade 2v2: the server stamps teamIndex on the game start info and
    // every client pins teams from it. The archived record is replayed
    // through the same team assignment, so these fields must survive
    // archiving — dropping them makes replays re-derive different teams and
    // desync from the recorded hashes.
    const ALICE = cid("alice");
    const BOB = cid("bob");
    const game = makeGame({
      config: { gameType: GameType.Public },
      creatorPersistentID: "alice-pid",
      matchmakingTeams: [["alice-pub"], ["bob-pub"]],
      deps: { archive },
    });
    const alice = makeClient({
      clientID: ALICE,
      persistentID: "alice-pid",
      username: "alice",
      clanTag: "AA",
      publicId: "alice-pub",
      friends: ["bob-pub"],
      ip: "1.1.1.1",
    });
    const bob = makeClient({
      clientID: BOB,
      persistentID: "bob-pid",
      username: "bob",
      publicId: "bob-pub",
      ip: "2.2.2.2",
    });
    game.joinClient(alice);
    game.joinClient(bob);
    startGame(game);

    // Both back the same winner: 2 of 2 IPs archives the game.
    for (const c of [alice, bob]) {
      await mockWsOf(c).emit({
        type: "winner",
        winner: ["player", ALICE],
        allPlayersStats: {},
      });
    }

    expect(archive).toHaveBeenCalledTimes(1);
    const [a, b] = archived().info.players;
    expect(a).toMatchObject({
      clientID: ALICE,
      username: "alice",
      clanTag: "AA",
      persistentID: "alice-pid",
      teamIndex: 0,
      friends: [BOB],
      isLobbyCreator: true,
    });
    expect(b).toMatchObject({
      clientID: BOB,
      teamIndex: 1,
      isLobbyCreator: false,
    });
    // No friends in the game is recorded as the field being absent.
    expect(b.friends).toBeUndefined();
    expect(archived().info.winner).toEqual(["player", ALICE]);
  });

  it("carries custom tribe names into the archived record for infra ingest and replays", async () => {
    const fetchTribes = vi.fn(async () => [
      { name: "Dragon Riders" },
      { name: "Night Wolves" },
    ]);
    const game = makeGame({
      config: { gameType: GameType.Public, bots: 2 },
      deps: { archive, fetchTribes },
    });
    game.joinClient(makeClient({ publicId: "someone-pub" }));

    game.prestart();
    await flushMicrotasks();
    game.start();
    // Ending an unfinished game archives it as it stands.
    await game.end();

    expect(archive).toHaveBeenCalledTimes(1);
    expect(archived().info.tribes).toEqual([
      { name: "Dragon Riders" },
      { name: "Night Wolves" },
    ]);
  });

  it("omits tribes from the archived record when none were fetched", async () => {
    const game = makeGame({
      config: { gameType: GameType.Public, bots: 2 },
      deps: { archive },
    });
    game.joinClient(makeClient());

    startGame(game);
    await game.end();

    expect(archive).toHaveBeenCalledTimes(1);
    expect(archived().info.tribes).toBeUndefined();
  });
});
