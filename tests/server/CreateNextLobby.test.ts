import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pass client messages through untouched so the test can drive the message
// handler directly (mirrors KickPlayerAuthorization.test).
vi.mock("../../src/core/Schemas", async () => {
  const actual = (await vi.importActual("../../src/core/Schemas")) as any;
  return {
    ...actual,
    GameStartInfoSchema: {
      safeParse: (data: any) => ({ success: true, data: data }),
    },
    ServerPrestartMessageSchema: {
      safeParse: (data: any) => ({ success: true, data: data }),
    },
    ClientMessageSchema: {
      safeParse: (data: any) => ({ success: true, data: data }),
    },
  };
});

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

async function sendCreateNextLobby(ws: ReturnType<typeof makeMockWs>) {
  await ws.trigger("message", JSON.stringify({ type: "create_next_lobby" }));
}

describe("GameServer - create_next_lobby", () => {
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

  it("lobby creator spawns a successor and broadcasts it to everyone", async () => {
    const game = makeGame("creator-pid");
    const factory = vi.fn(() => SUCCESSOR_ID);
    game.createSuccessorLobby = factory;

    const { client: creator, ws: creatorWs } = makeClient(
      "creator-cid",
      "creator-pid",
    );
    const { client: other, ws: otherWs } = makeClient("other-cid", "other-pid");
    game.joinClient(creator);
    game.joinClient(other);

    await sendCreateNextLobby(creatorWs);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(newLobbyBroadcasts(creatorWs)).toHaveLength(1);
    expect(newLobbyBroadcasts(otherWs)).toHaveLength(1);
    expect(newLobbyBroadcasts(otherWs)[0]).toContain(SUCCESSOR_ID);
  });

  it("ignores the request from a non-creator", async () => {
    const game = makeGame("creator-pid");
    const factory = vi.fn(() => SUCCESSOR_ID);
    game.createSuccessorLobby = factory;

    const { client: creator, ws: creatorWs } = makeClient(
      "creator-cid",
      "creator-pid",
    );
    const { client: rando, ws: randoWs } = makeClient("rando-cid", "rando-pid");
    game.joinClient(creator);
    game.joinClient(rando);

    await sendCreateNextLobby(randoWs);

    expect(factory).not.toHaveBeenCalled();
    expect(newLobbyBroadcasts(randoWs)).toHaveLength(0);
    expect(newLobbyBroadcasts(creatorWs)).toHaveLength(0);
  });

  it("is idempotent: repeat clicks reuse the same successor", async () => {
    const game = makeGame("creator-pid");
    const factory = vi.fn(() => SUCCESSOR_ID);
    game.createSuccessorLobby = factory;

    const { client: creator, ws: creatorWs } = makeClient(
      "creator-cid",
      "creator-pid",
    );
    game.joinClient(creator);

    await sendCreateNextLobby(creatorWs);
    await sendCreateNextLobby(creatorWs);

    // Created once, re-broadcast on the second click.
    expect(factory).toHaveBeenCalledTimes(1);
    expect(newLobbyBroadcasts(creatorWs)).toHaveLength(2);
  });

  it("does nothing when the game cannot spawn a successor (no factory)", async () => {
    const game = makeGame("creator-pid");
    // No createSuccessorLobby wired (e.g. a public game).

    const { client: creator, ws: creatorWs } = makeClient(
      "creator-cid",
      "creator-pid",
    );
    game.joinClient(creator);

    await sendCreateNextLobby(creatorWs);

    expect(newLobbyBroadcasts(creatorWs)).toHaveLength(0);
  });
});
