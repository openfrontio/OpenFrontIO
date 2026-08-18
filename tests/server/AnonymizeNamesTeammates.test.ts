import { GameType } from "../../src/core/game/Game";
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

// clanTag and friends are populated on purpose. An earlier version of this file
// left them null/empty, which made the "team-assignment inputs stay blank"
// assertion pass for the wrong reason — it would have passed even if the server
// leaked them.
function makeClient(
  clientID: string,
  username: string,
  publicId: string,
  clanTag: string | null = "CLAN",
  friends: string[] = [],
) {
  return new Client(
    clientID,
    `${clientID}-pid`,
    null,
    null,
    undefined,
    "127.0.0.1",
    username,
    clanTag,
    makeMockWs() as any,
    { verified: true },
    publicId,
    friends,
  );
}

// alice+bob are one pinned team, carol+dave the other. Bob is friends with carol,
// an OPPONENT — so a friends leak to alice would expose a third party.
function makeGame(matchmakingTeams?: string[][]) {
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
    { gameType: GameType.Private, anonymizeNames: true } as any,
    "creator-pid",
    undefined,
    undefined,
    matchmakingTeams,
  );
  [
    makeClient("alice", "AliceReal", "alice-pub", "AAA"),
    makeClient("bob", "BobReal", "bob-pub", "BBB", ["carol-pub"]),
    makeClient("carol", "CarolReal", "carol-pub", "CCC"),
    makeClient("dave", "DaveReal", "dave-pub", "DDD"),
  ].forEach((c) => game.joinClient(c));
  return game;
}

const TEAMS = [
  ["alice-pub", "bob-pub"],
  ["carol-pub", "dave-pub"],
];
const REAL = ["AliceReal", "BobReal", "CarolReal", "DaveReal"];
const byId = (info: any, id: string) =>
  info.clients.find((c: any) => c.clientID === id);
const player = (info: any, id: string) =>
  info.players.find((p: any) => p.clientID === id);

describe("anonymizeNames: a team shares one view of everyone else", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("gives teammates the SAME fake name for a given opponent", () => {
    // The point of the team: they can call a target. Seeding the rotation per
    // viewer meant alice and bob saw the same opponent under different names,
    // so neither could tell the other who to attack.
    const game = makeGame(TEAMS);
    const alice = game.gameInfo("alice");
    const bob = game.gameInfo("bob");
    for (const opponent of ["carol", "dave"]) {
      expect(byId(alice, opponent).username).toBe(byId(bob, opponent).username);
      expect(REAL).not.toContain(byId(alice, opponent).username);
    }
  });

  it("still shows the OTHER team a different set of names", () => {
    // Anti-teaming holds across the boundary: sharing inside a team must not
    // become one mapping for the whole lobby.
    //
    // dave gets a team of his own so BOTH viewers anonymize him. Against the
    // two-team fixture carol would be his teammate and see his real name, and
    // the comparison would pass even if every team shared one seed.
    const game = makeGame([
      ["alice-pub", "bob-pub"],
      ["carol-pub"],
      ["dave-pub"],
    ]);
    const alice = game.gameInfo("alice");
    const carol = game.gameInfo("carol");
    expect(REAL).not.toContain(byId(alice, "dave").username);
    expect(REAL).not.toContain(byId(carol, "dave").username);
    expect(byId(alice, "dave").username).not.toBe(byId(carol, "dave").username);
  });

  it("keeps per-viewer names when the game is not matchmade", () => {
    // No pins, no teams — nothing to share a seed with, so the original
    // per-viewer rotation is unchanged.
    const game = makeGame();
    const alice = game.gameInfo("alice");
    const bob = game.gameInfo("bob");
    expect(byId(alice, "dave").username).not.toBe(byId(bob, "dave").username);
  });
});

describe("anonymizeNames: pinned teammates see each other (lobby)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("shows a teammate's real name", () => {
    const info = makeGame(TEAMS).gameInfo("alice");
    expect(byId(info, "bob").username).toBe("BobReal");
  });

  it("still hides the other team", () => {
    const info = makeGame(TEAMS).gameInfo("alice");
    for (const id of ["carol", "dave"]) {
      expect(REAL).not.toContain(byId(info, id).username);
    }
  });

  it("does NOT leak a teammate's clanTag", () => {
    // clanTag feeds assignTeams and is exactly the kind of identity the host
    // chose to hide; coordinating needs the name, not the tag.
    expect(byId(makeGame(TEAMS).gameInfo("alice"), "bob").clanTag).toBeNull();
  });

  it("does NOT leak a teammate's friends — that names a THIRD party", () => {
    // Bob is friends with carol, who is on the opposing team and still
    // anonymized. Revealing it would tell alice something about carol that the
    // host never granted.
    expect(
      byId(makeGame(TEAMS).gameInfo("alice"), "bob").friends,
    ).toBeUndefined();
  });

  it("still gives the viewer their OWN clanTag and friends", () => {
    // The teammate narrowing must not regress the pre-existing self reveal.
    const info = makeGame(TEAMS).gameInfo("bob");
    expect(byId(info, "bob").clanTag).toBe("BBB");
    expect(byId(info, "bob").friends).toEqual(["carol"]);
  });

  it("hides everyone when the game is not matchmade", () => {
    // Without pins the server has no team to compare — teams are resolved on the
    // clients from clanTag/friends — so nothing is revealed.
    const info = makeGame(undefined).gameInfo("alice");
    expect(byId(info, "alice").username).toBe("AliceReal"); // self, as before
    for (const id of ["bob", "carol", "dave"]) {
      expect(REAL).not.toContain(byId(info, id).username);
    }
  });

  it("reveals nothing to a player who is in no pinned team", () => {
    const info = makeGame([["carol-pub", "dave-pub"]]).gameInfo("alice");
    for (const id of ["bob", "carol", "dave"]) {
      expect(REAL).not.toContain(byId(info, id).username);
    }
  });

  it("is symmetric — the teammate sees back", () => {
    expect(byId(makeGame(TEAMS).gameInfo("bob"), "alice").username).toBe(
      "AliceReal",
    );
  });
});

// startInfoFor reads wireGameStartInfo, which is only built when the game starts,
// so it is stubbed here the same way AnonymizeNames.test.ts does it. clanTag and
// friends are populated so the "blank for everyone" assertion is meaningful.
function withStartInfo(matchmakingTeams?: string[][]) {
  const game = makeGame(matchmakingTeams);
  const players = [
    {
      clientID: "alice",
      username: "AliceReal",
      clanTag: "AAA",
      friends: ["bob"],
    },
    {
      clientID: "bob",
      username: "BobReal",
      clanTag: "BBB",
      friends: ["carol"],
    },
    { clientID: "carol", username: "CarolReal", clanTag: "CCC", friends: [] },
    { clientID: "dave", username: "DaveReal", clanTag: "DDD", friends: [] },
  ];
  const startInfo = { gameID: "g1", lobbyCreatedAt: 0, config: {}, players };
  (game as any).gameStartInfo = startInfo;
  (game as any).wireGameStartInfo = JSON.parse(JSON.stringify(startInfo));
  return game;
}

describe("anonymizeNames: pinned teammates in the IN-GAME start payload", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // startInfoFor is the payload that actually fixes "can't coordinate mid-game",
  // so the invariant is locked in here and not only in the lobby view.
  it("reveals a teammate's real username", () => {
    const info = (withStartInfo(TEAMS) as any).startInfoFor("alice", false);
    expect(player(info, "bob").username).toBe("BobReal");
  });

  it("keeps the opposing team anonymized", () => {
    const info = (withStartInfo(TEAMS) as any).startInfoFor("alice", false);
    for (const id of ["carol", "dave"]) {
      expect(REAL).not.toContain(player(info, id).username);
    }
  });

  it("keeps clanTag null and friends undefined for EVERY player", () => {
    // These feed assignTeams. A per-viewer difference here desyncs the clients,
    // which is why the in-game payload blanks them for everyone regardless of
    // who can see whose name.
    const info = (withStartInfo(TEAMS) as any).startInfoFor("alice", false);
    for (const id of ["alice", "bob", "carol", "dave"]) {
      expect(player(info, id).clanTag).toBeNull();
      expect(player(info, id).friends).toBeUndefined();
    }
  });
});
