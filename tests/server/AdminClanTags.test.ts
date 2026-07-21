import { GameMode, GameType } from "../../src/core/game/Game";
import { GameServer } from "../../src/server/GameServer";

// Admins see real clan tags in FFA so they can spot teaming live. The reveal is
// gated on FFA — that mode never runs assignTeams, so clanTag never feeds the
// simulation. A Team game with tags disabled DOES assign teams by clanTag, so a
// per-viewer reveal there would desync; those cases must stay stripped.

// Build a GameServer with start info already populated, mirroring how start()
// leaves it: gameStartInfo keeps real clan tags; wireGameStartInfo is the
// stripped copy clients normally receive when disableClanTags is set.
function makeGame(gameMode: GameMode, anonymizeNames = false) {
  const logger: any = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const game = new GameServer(
    "g1",
    logger,
    Date.now(),
    {
      gameType: GameType.Private,
      gameMode,
      disableClanTags: true,
      anonymizeNames,
    } as any,
    "creator-pid",
  );
  const players = [
    { clientID: "creator", username: "CreatorReal", clanTag: "HOST" },
    { clientID: "alice", username: "AliceReal", clanTag: "AAA" },
    { clientID: "charlie", username: "CharlieReal", clanTag: null },
  ];
  const startInfo = { gameID: "g1", lobbyCreatedAt: 0, config: {}, players };
  (game as any).gameStartInfo = startInfo;
  // Wire copy strips clan tags (what disableClanTags does in start()).
  (game as any).wireGameStartInfo = {
    ...startInfo,
    players: players.map((p) => ({ ...p, clanTag: null })),
  };
  return game;
}

const startInfoFor = (game: GameServer, viewer: string, isAdmin: boolean) =>
  (game as any).startInfoFor(viewer, isAdmin);
const player = (info: any, id: string) =>
  info.players.find((p: any) => p.clientID === id);

describe("startInfoFor: admin clan-tag reveal in FFA", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("FFA + admin: sees real clan tags", () => {
    const info = startInfoFor(makeGame(GameMode.FFA), "admin", true);
    expect(player(info, "creator").clanTag).toBe("HOST");
    expect(player(info, "alice").clanTag).toBe("AAA");
    expect(player(info, "charlie").clanTag).toBeNull(); // never had one
  });

  it("FFA + non-admin: clan tags stay stripped", () => {
    const info = startInfoFor(makeGame(GameMode.FFA), "alice", false);
    expect(player(info, "creator").clanTag).toBeNull();
    expect(player(info, "alice").clanTag).toBeNull();
  });

  it("Team + tags disabled + admin: NOT revealed (desync guard)", () => {
    // Team mode assigns teams by clanTag, so revealing it to only the admin
    // would diverge that client's team assignment — must stay stripped.
    const info = startInfoFor(makeGame(GameMode.Team), "admin", true);
    expect(player(info, "creator").clanTag).toBeNull();
    expect(player(info, "alice").clanTag).toBeNull();
  });

  it("never mutates gameStartInfo (the archived record stays real)", () => {
    const game = makeGame(GameMode.FFA);
    startInfoFor(game, "admin", true);
    expect((game as any).gameStartInfo.players[0].clanTag).toBe("HOST");
    // The shared wire copy stays stripped for non-admins.
    expect((game as any).wireGameStartInfo.players[0].clanTag).toBeNull();
  });

  it("anonymized FFA + admin: reveals clan tags but still anonymizes others", () => {
    const game = makeGame(GameMode.FFA, true);
    const info = startInfoFor(game, "admin", true);
    // Real tags are revealed...
    expect(player(info, "alice").clanTag).toBe("AAA");
    // ...but other players' usernames are still anonymized.
    expect(player(info, "alice").username).not.toBe("AliceReal");
  });
});
