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

vi.mock("../../src/server/Archive", () => ({
  archive: vi.fn(),
  finalizeGameRecord: (r: any) => r,
}));

import { GameType } from "../../src/core/game/Game";
import { Client } from "../../src/server/Client";
import { archive } from "../../src/server/Archive";
import { GameServer } from "../../src/server/GameServer";

function makeMockWs(ip = "1.2.3.4") {
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
  ip = "1.2.3.4",
): { client: Client; ws: ReturnType<typeof makeMockWs> } {
  const ws = makeMockWs(ip);
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

describe("GameServer - winner message security", () => {
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

  it("archives with undefined stats regardless of client-supplied allPlayersStats", async () => {
    const game = new GameServer(
      "test-game",
      mockLogger,
      Date.now(),
      { gameType: GameType.Private } as any,
    );

    const { client: c1, ws: ws1 } = makeClient("cid-1", "pid-1", "1.2.3.4");
    const { client: c2, ws: ws2 } = makeClient("cid-2", "pid-2", "5.6.7.8");
    game.joinClient(c1);
    game.joinClient(c2);
    game.start();

    // Both clients vote for the same winner and attach fabricated stats.
    // Majority threshold is met so archiveGame() is triggered.
    const fabricatedStats = {
      "cid-1": { kills: 9999, gold: 9999 } as any,
      "cid-2": { kills: 9999, gold: 9999 } as any,
    };

    await ws1.trigger(
      "message",
      JSON.stringify({
        type: "winner",
        winner: ["player", "cid-1"],
        allPlayersStats: fabricatedStats,
      }),
    );
    await ws2.trigger(
      "message",
      JSON.stringify({
        type: "winner",
        winner: ["player", "cid-1"],
        allPlayersStats: fabricatedStats,
      }),
    );

    expect(archive).toHaveBeenCalledOnce();
    const archivedRecord = (archive as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    for (const player of archivedRecord.info.players) {
      expect(player.stats).toBeUndefined();
    }
  });
});
