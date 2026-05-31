import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  ip: string = "127.0.0.1",
): { client: Client; ws: ReturnType<typeof makeMockWs> } {
  const ws = makeMockWs();
  const client = new Client(
    clientID,
    persistentID,
    null,
    null,
    undefined,
    ip,
    "TestUser",
    null,
    ws as any,
    undefined,
    undefined,
    [],
  );
  return { client, ws };
}

describe("GameServer - winner consensus validation", () => {
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

  function makeGame() {
    const game = new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);
    // Mock archiveGame so we don't hit external calls
    (game as any).archiveGame = vi.fn();
    return game;
  }

  it("1v1 match with two active players does not allow winner spoofing by a single player", async () => {
    const game = makeGame();
    // Simulate game starting so start logic is covered
    game.start();

    const { client: playerA, ws: wsA } = makeClient(
      "cid-a",
      "pid-a",
      "1.1.1.1",
    );
    const { client: playerB } = makeClient("cid-b", "pid-b", "2.2.2.2");

    game.joinClient(playerA);
    game.joinClient(playerB);

    // Player A votes for themselves as winner
    await wsA.trigger(
      "message",
      JSON.stringify({
        type: "winner",
        winner: ["player", "cid-a"],
        allPlayersStats: {},
      }),
    );

    // Expect no winner determined yet (requires consensus or disconnect)
    expect((game as any).winner).toBeNull();
    expect((game as any).archiveGame).not.toHaveBeenCalled();
  });

  it("1v1 match with two active players determines winner when both agree", async () => {
    const game = makeGame();
    game.start();

    const { client: playerA, ws: wsA } = makeClient(
      "cid-a",
      "pid-a",
      "1.1.1.1",
    );
    const { client: playerB, ws: wsB } = makeClient(
      "cid-b",
      "pid-b",
      "2.2.2.2",
    );

    game.joinClient(playerA);
    game.joinClient(playerB);

    // Both vote for player A
    const winnerMsg = {
      type: "winner",
      winner: ["player", "cid-a"],
      allPlayersStats: {},
    };

    await wsA.trigger("message", JSON.stringify(winnerMsg));
    expect((game as any).winner).toBeNull();

    await wsB.trigger("message", JSON.stringify(winnerMsg));

    // Consensus reached!
    expect((game as any).winner).toBeDefined();
    expect((game as any).winner).not.toBeNull();
    expect((game as any).winner?.winner).toEqual(["player", "cid-a"]);
    expect((game as any).archiveGame).toHaveBeenCalledOnce();
  });

  it("when player B disconnects, player A's pending winner vote is immediately processed and resolved", async () => {
    const game = makeGame();
    game.start();

    const { client: playerA, ws: wsA } = makeClient(
      "cid-a",
      "pid-a",
      "1.1.1.1",
    );
    const { client: playerB, ws: wsB } = makeClient(
      "cid-b",
      "pid-b",
      "2.2.2.2",
    );

    game.joinClient(playerA);
    game.joinClient(playerB);

    // Player A votes for themselves
    await wsA.trigger(
      "message",
      JSON.stringify({
        type: "winner",
        winner: ["player", "cid-a"],
        allPlayersStats: {},
      }),
    );
    expect((game as any).winner).toBeNull();

    // Player B disconnects
    await wsB.trigger("close");

    // The single remaining player A has the strict majority (1/1)
    expect((game as any).winner).toBeDefined();
    expect((game as any).winner).not.toBeNull();
    expect((game as any).winner?.winner).toEqual(["player", "cid-a"]);
    expect((game as any).archiveGame).toHaveBeenCalledOnce();
  });

  it("prevents Sybil attacks: multiple connections from the same IP are collapsed into one vote", async () => {
    const game = makeGame();
    game.start();

    // Player A and their clone connect from the same IP
    const { client: playerA, ws: wsA } = makeClient(
      "cid-a",
      "pid-a",
      "1.1.1.1",
    );
    const { client: playerAClone, ws: wsAClone } = makeClient(
      "cid-a-clone",
      "pid-a-clone",
      "1.1.1.1",
    );
    const { client: playerB } = makeClient("cid-b", "pid-b", "2.2.2.2");

    game.joinClient(playerA);
    game.joinClient(playerAClone);
    game.joinClient(playerB);

    // Both A and their clone vote for A
    const winnerMsg = {
      type: "winner",
      winner: ["player", "cid-a"],
      allPlayersStats: {},
    };

    await wsA.trigger("message", JSON.stringify(winnerMsg));
    await wsAClone.trigger("message", JSON.stringify(winnerMsg));

    // Even though there are 2 votes, since they share the same IP, they collapse to 1 unique IP vote.
    // Out of 2 unique active IPs ("1.1.1.1" and "2.2.2.2"), 1 vote does not make a strict majority (1 * 2 <= 2).
    expect((game as any).winner).toBeNull();
    expect((game as any).archiveGame).not.toHaveBeenCalled();
  });
});
