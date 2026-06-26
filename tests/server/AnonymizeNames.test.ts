import { GameType } from "../../src/core/game/Game";
import { UsernameSchema } from "../../src/core/Schemas";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";

function makeMockWs() {
  return {
    on: () => {},
    removeAllListeners: () => {},
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  };
}

function makeClient(
  clientID: string,
  persistentID: string,
  username: string,
  clanTag: string | null,
  role: string | null = null,
  publicId: string | undefined = undefined,
  friends: string[] = [],
): Client {
  return new Client(
    clientID,
    persistentID,
    null,
    role,
    undefined,
    "127.0.0.1",
    username,
    clanTag,
    makeMockWs() as any,
    undefined,
    publicId,
    friends,
  );
}

// creator = lobby host, admin = admin role, alice + bob = regular players.
function makeGame(
  anonymizeNames: boolean,
  disableClanTags = false,
  nameReveals: string[] = [],
  nameRevealPublicIds: string[] = [],
) {
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
      anonymizeNames,
      disableClanTags,
      nameReveals,
      nameRevealPublicIds,
    } as any,
    "creator-pid",
  );
  [
    makeClient("creator", "creator-pid", "CreatorReal", "HOST"),
    makeClient("admin", "admin-pid", "AdminReal", "ADM", "admin"),
    makeClient("alice", "alice-pid", "AliceReal", "AAA", null, "alice-pub", [
      "bob-pub",
    ]),
    makeClient("bob", "bob-pid", "BobReal", "BBB", null, "bob-pub"),
  ].forEach((c) => game.joinClient(c));
  return game;
}

const REAL_NAMES = ["CreatorReal", "AdminReal", "AliceReal", "BobReal"];
const byId = (info: any, id: string) =>
  info.clients.find((c: any) => c.clientID === id);

describe("anonymizeNames: gameInfo (lobby / HTTP / preview)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("off: everyone sees real names and clan tags", () => {
    const info = makeGame(false).gameInfo("alice");
    expect(byId(info, "bob").username).toBe("BobReal");
    expect(byId(info, "creator").clanTag).toBe("HOST");
  });

  it("on: a regular player sees themselves but not others", () => {
    const info = makeGame(true).gameInfo("alice");
    expect(byId(info, "alice").username).toBe("AliceReal"); // self
    const bob = byId(info, "bob");
    expect(bob.username).not.toBe("BobReal");
    expect(REAL_NAMES).not.toContain(bob.username);
    expect(bob.clanTag).toBeNull();
    expect(bob.friends).toBeUndefined();
    expect(UsernameSchema.safeParse(bob.username).success).toBe(true);
  });

  it("on: nobody is exempt by default, not even the host", () => {
    const info = makeGame(true).gameInfo("creator");
    expect(byId(info, "creator").username).toBe("CreatorReal"); // own name
    const bob = byId(info, "bob");
    expect(bob.username).not.toBe("BobReal"); // host does NOT see others
    expect(REAL_NAMES).not.toContain(bob.username);
  });

  it("on: a granted viewer (nameReveals) sees everyone's real names", () => {
    const info = makeGame(true, false, ["alice"]).gameInfo("alice");
    for (const id of ["creator", "admin", "bob"]) {
      expect(REAL_NAMES).toContain(byId(info, id).username);
    }
  });

  it("on: a non-granted viewer still sees only themselves", () => {
    const info = makeGame(true, false, ["alice"]).gameInfo("bob");
    expect(byId(info, "bob").username).toBe("BobReal"); // self
    expect(REAL_NAMES).not.toContain(byId(info, "alice").username);
  });

  it("on: a viewer granted by account (nameRevealPublicIds) sees everyone's real names", () => {
    // alice's clientID is "alice", her account publicId is "alice-pub" — the grant
    // is keyed by publicId and resolved back to her clientID at lookup.
    const info = makeGame(true, false, [], ["alice-pub"]).gameInfo("alice");
    for (const id of ["creator", "admin", "bob"]) {
      expect(REAL_NAMES).toContain(byId(info, id).username);
    }
  });

  it("on: a viewer NOT in nameRevealPublicIds still sees only themselves", () => {
    const info = makeGame(true, false, [], ["alice-pub"]).gameInfo("bob");
    expect(byId(info, "bob").username).toBe("BobReal"); // self
    expect(REAL_NAMES).not.toContain(byId(info, "alice").username);
  });

  it("on: no viewer (HTTP / preview) anonymizes everyone", () => {
    const info = makeGame(true).gameInfo();
    for (const id of ["creator", "admin", "alice", "bob"]) {
      expect(REAL_NAMES).not.toContain(byId(info, id).username);
      expect(byId(info, id).clanTag).toBeNull();
    }
  });

  it("on: a viewer's view of a player is stable across calls", () => {
    const game = makeGame(true);
    expect(byId(game.gameInfo("alice"), "bob").username).toBe(
      byId(game.gameInfo("alice"), "bob").username,
    );
  });
});

describe("anonymizeNames: config updates propagate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("turning it off un-anonymizes (not stuck on)", () => {
    const game = makeGame(true);
    game.updateGameConfig({ anonymizeNames: false });
    expect(byId(game.gameInfo("alice"), "bob").username).toBe("BobReal");
  });

  it("clearing nameReveals revokes the grant", () => {
    const game = makeGame(true, false, ["alice"]);
    expect(byId(game.gameInfo("alice"), "bob").username).toBe("BobReal"); // granted
    game.updateGameConfig({ nameReveals: [] });
    expect(byId(game.gameInfo("alice"), "bob").username).not.toBe("BobReal"); // revoked
  });

  it("granting nameRevealPublicIds at runtime reveals by account; clearing revokes", () => {
    const game = makeGame(true);
    expect(byId(game.gameInfo("alice"), "bob").username).not.toBe("BobReal"); // not granted
    game.updateGameConfig({ nameRevealPublicIds: ["alice-pub"] });
    expect(byId(game.gameInfo("alice"), "bob").username).toBe("BobReal"); // granted by account
    game.updateGameConfig({ nameRevealPublicIds: [] });
    expect(byId(game.gameInfo("alice"), "bob").username).not.toBe("BobReal"); // revoked
  });
});

describe("anonymizeNames: startInfoFor (in-game start payload)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function withStartInfo(anonymizeNames: boolean) {
    const game = makeGame(anonymizeNames);
    const players = [
      {
        clientID: "creator",
        username: "CreatorReal",
        clanTag: "HOST",
        isLobbyCreator: true,
        friends: [],
      },
      {
        clientID: "alice",
        username: "AliceReal",
        clanTag: "AAA",
        cosmetics: { flag: "fr" },
        friends: ["bob"],
      },
      { clientID: "bob", username: "BobReal", clanTag: "BBB", friends: [] },
    ];
    const startInfo = { gameID: "g1", lobbyCreatedAt: 0, config: {}, players };
    (game as any).gameStartInfo = startInfo;
    (game as any).wireGameStartInfo = JSON.parse(JSON.stringify(startInfo));
    return game;
  }

  const player = (info: any, id: string) =>
    info.players.find((x: any) => x.clientID === id);

  it("anonymizes others, keeps self, strips clan/cosmetics/friends", () => {
    const info = (withStartInfo(true) as any).startInfoFor("bob");
    expect(player(info, "bob").username).toBe("BobReal"); // self
    const alice = player(info, "alice");
    expect(alice.username).not.toBe("AliceReal");
    expect(UsernameSchema.safeParse(alice.username).success).toBe(true);
    expect(alice.clanTag).toBeNull();
    expect(alice.cosmetics).toBeUndefined();
    expect(alice.friends).toBeUndefined();
  });

  it("shows the same anonymized name in-game as in the lobby", () => {
    const game = withStartInfo(true);
    const inGame = player((game as any).startInfoFor("bob"), "alice").username;
    expect(inGame).toBe(byId(game.gameInfo("bob"), "alice").username);
  });

  it("never mutates gameStartInfo (the archived record stays real)", () => {
    const game = withStartInfo(true);
    (game as any).startInfoFor("bob");
    const rec = player((game as any).gameStartInfo, "alice");
    expect(rec.username).toBe("AliceReal");
    expect(rec.clanTag).toBe("AAA");
    expect(rec.cosmetics).toEqual({ flag: "fr" });
  });

  it("off: returns the shared wire start info unchanged", () => {
    const game = withStartInfo(false);
    expect((game as any).startInfoFor("bob")).toBe(
      (game as any).wireGameStartInfo,
    );
  });
});
