import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/Archive", () => ({
  archive: vi.fn(),
  finalizeGameRecord: (record: unknown) => record,
}));

import { GameType } from "../../src/core/game/Game";
import { archive } from "../../src/server/Archive";
import { GameServer } from "../../src/server/GameServer";

describe("archiveGame player records", () => {
  let mockLogger: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  it("preserves simulation inputs (teamIndex, friends, isLobbyCreator) so replays stay in sync", () => {
    const game = new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Public,
    } as any);

    // Matchmade 2v2: the server stamps teamIndex on the game start info and
    // every client pins teams from it. The archived record is replayed
    // through the same team assignment, so these fields must survive
    // archiving — dropping them makes replays re-derive different teams and
    // desync from the recorded hashes.
    (game as any).gameStartInfo = {
      gameID: "test-game",
      lobbyCreatedAt: 0,
      config: { gameType: GameType.Public },
      players: [
        {
          clientID: "clientAAA",
          username: "alice",
          clanTag: "AA",
          cosmetics: {},
          isLobbyCreator: true,
          friends: ["clientBBB"],
          teamIndex: 0,
        },
        {
          clientID: "clientBBB",
          username: "bob",
          clanTag: null,
          cosmetics: {},
          isLobbyCreator: false,
          friends: [],
          teamIndex: 1,
        },
      ],
    };

    (game as any).archiveGame();

    expect(archive).toHaveBeenCalledTimes(1);
    const record = vi.mocked(archive).mock.calls[0][0] as any;
    const [alice, bob] = record.info.players;

    expect(alice).toMatchObject({
      clientID: "clientAAA",
      teamIndex: 0,
      friends: ["clientBBB"],
      isLobbyCreator: true,
    });
    expect(bob).toMatchObject({
      clientID: "clientBBB",
      teamIndex: 1,
      friends: [],
      isLobbyCreator: false,
    });
  });
});
