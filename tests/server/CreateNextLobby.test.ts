import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";

function makeMockWs() {
  const handlers: Record<string, (...args: any[]) => any> = {};
  return {
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers[event] = handler;
    },
    removeAllListeners: (_event: string) => {},
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    trigger: (event: string, ...args: any[]) => handlers[event]?.(...args),
  };
}

function makeClient(
  clientID: string,
  persistentID: string,
): { client: Client; ws: ReturnType<typeof makeMockWs> } {
  const ws = makeMockWs();
  const client = new Client(
    clientID,
    persistentID,
    null,
    null,
    undefined,
    "127.0.0.1",
    "TestUser",
    null,
    ws as any,
    undefined,
    undefined,
    [],
  );
  return { client, ws };
}

// The successor id the broadcast should carry (8-char id shape).
const SUCCESSOR_ID = "SUCCES01";

function newLobbyBroadcasts(ws: ReturnType<typeof makeMockWs>): string[] {
  return ws.send.mock.calls
    .map((c: any[]) => c[0])
    .filter(
      (m: unknown) => typeof m === "string" && m.includes('"type":"new_lobby"'),
    );
}

// The worker's create_game?previous= flow calls setSuccessorLobby on the
// finished game after minting the successor: the game must remember the id
// (so repeat requests reuse it) and broadcast it to everyone still connected.
describe("GameServer - successor lobby", () => {
  let mockLogger: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  function makeGame(creatorPersistentID?: string) {
    return new GameServer(
      "test-game",
      mockLogger,
      Date.now(),
      { gameType: GameType.Private } as any,
      creatorPersistentID,
    );
  }

  it("broadcasts the successor id to everyone still connected", () => {
    const game = makeGame("creator-pid");
    const { client: creator, ws: creatorWs } = makeClient(
      "creator-cid",
      "creator-pid",
    );
    const { client: other, ws: otherWs } = makeClient("other-cid", "other-pid");
    game.joinClient(creator);
    game.joinClient(other);

    game.setSuccessorLobby(SUCCESSOR_ID);

    expect(newLobbyBroadcasts(creatorWs)).toHaveLength(1);
    expect(newLobbyBroadcasts(otherWs)).toHaveLength(1);
    expect(newLobbyBroadcasts(otherWs)[0]).toContain(SUCCESSOR_ID);
  });

  it("remembers the successor id so repeat requests can reuse it", () => {
    const game = makeGame("creator-pid");
    expect(game.successorLobby()).toBeNull();

    game.setSuccessorLobby(SUCCESSOR_ID);

    expect(game.successorLobby()).toBe(SUCCESSOR_ID);
  });

  it("re-broadcasts on a repeat call (double click) with the same id", () => {
    const game = makeGame("creator-pid");
    const { client: creator, ws: creatorWs } = makeClient(
      "creator-cid",
      "creator-pid",
    );
    game.joinClient(creator);

    game.setSuccessorLobby(SUCCESSOR_ID);
    game.setSuccessorLobby(SUCCESSOR_ID);

    expect(newLobbyBroadcasts(creatorWs)).toHaveLength(2);
    expect(game.successorLobby()).toBe(SUCCESSOR_ID);
  });

  it("authorizes successor creation by creator persistentID", () => {
    const game = makeGame("creator-pid");
    // The worker checks isCreator() before minting a successor.
    expect(game.isCreator("creator-pid")).toBe(true);
    expect(game.isCreator("rando-pid")).toBe(false);
  });
});
