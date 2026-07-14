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

function makeClient(
  clientID: string,
  publicId: string | undefined,
  showPublicProfile: boolean,
): Client {
  return new Client(
    clientID,
    `${clientID}-pid`,
    null,
    null,
    undefined,
    "127.0.0.1",
    `${clientID}Name`,
    null,
    makeMockWs() as any,
    undefined,
    publicId,
    [],
    showPublicProfile,
  );
}

function makeGame(anonymizeNames = false) {
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
    { gameType: GameType.Private, anonymizeNames } as any,
    "opted-pid",
  );
  [
    makeClient("opted", "opted-pub", true),
    makeClient("private", "private-pub", false),
  ].forEach((c) => game.joinClient(c));
  return game;
}

const byId = (info: any, id: string) =>
  info.clients.find((c: any) => c.clientID === id);

describe("public profile: gameInfo exposes publicId only when opted in", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("includes publicId for a client that opted in", () => {
    const info = makeGame().gameInfo("opted");
    expect(byId(info, "opted").publicId).toBe("opted-pub");
  });

  it("omits publicId for a client that did not opt in", () => {
    const info = makeGame().gameInfo("opted");
    expect(byId(info, "private").publicId).toBeUndefined();
  });

  it("still exposes an opted-in player's publicId when names are anonymized", () => {
    const info = makeGame(true).gameInfo("private");
    expect(byId(info, "opted").publicId).toBe("opted-pub");
  });
});
