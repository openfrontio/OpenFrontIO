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

function makeClient(clientID: string, username: string, publicId: string) {
  return new Client(
    clientID,
    `${clientID}-pid`,
    null,
    null,
    undefined,
    "127.0.0.1",
    username,
    null,
    makeMockWs() as any,
    undefined,
    publicId,
    [],
  );
}

// alice+bob are one pinned team, carol+dave the other.
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
    makeClient("alice", "AliceReal", "alice-pub"),
    makeClient("bob", "BobReal", "bob-pub"),
    makeClient("carol", "CarolReal", "carol-pub"),
    makeClient("dave", "DaveReal", "dave-pub"),
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

describe("anonymizeNames: pinned teammates see each other", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("shows a teammate's real name", () => {
    // Anonymizing a player from their own team makes the team unplayable.
    const info = makeGame(TEAMS).gameInfo("alice");
    expect(byId(info, "bob").username).toBe("BobReal");
  });

  it("still hides the other team", () => {
    const info = makeGame(TEAMS).gameInfo("alice");
    for (const id of ["carol", "dave"]) {
      expect(REAL).not.toContain(byId(info, id).username);
    }
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
    const info = makeGame(TEAMS).gameInfo("bob");
    expect(byId(info, "alice").username).toBe("AliceReal");
  });

  it("keeps the team-assignment inputs blank for everyone", () => {
    // clanTag and friends feed assignTeams, so revealing them per viewer would
    // desync. Only username/cosmetics widen.
    const info = makeGame(TEAMS).gameInfo("alice");
    expect(byId(info, "bob").clanTag ?? null).toBeNull();
  });
});
