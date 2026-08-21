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
  };
});

import { GameType } from "../../src/core/game/Game";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";
import { clientFrame, testGameConfig } from "../util/Wire";

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
  role?: string,
): { client: Client; ws: ReturnType<typeof makeMockWs> } {
  const ws = makeMockWs();
  const client = new Client(
    clientID,
    persistentID,
    null,
    role ?? null,
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

describe("GameServer - kick_player authorization", () => {
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
      testGameConfig({ gameType: GameType.Private }),
      creatorPersistentID,
    );
  }

  async function sendKickMessage(
    ws: ReturnType<typeof makeMockWs>,
    target: string,
  ) {
    await ws.trigger(
      "message",
      clientFrame({
        type: "intent",
        intent: { type: "kick_player", targetClientID: target },
      }),
    );
  }

  it("lobby creator can kick another player with lobby_creator reason", async () => {
    const game = makeGame("creator-pid");
    const kickSpy = vi.spyOn(game, "kickClient");

    const { client: creator, ws: creatorWs } = makeClient(
      "creator1",
      "creator-pid",
    );
    const { client: target } = makeClient("target01", "target-pid");

    game.joinClient(creator);
    game.joinClient(target);

    await sendKickMessage(creatorWs, "target01");

    expect(kickSpy).toHaveBeenCalledOnce();
    expect(kickSpy).toHaveBeenCalledWith(
      "target01",
      "kick_reason.lobby_creator",
    );
  });

  it("admin-flared player can kick another player with admin reason", async () => {
    const game = makeGame();
    const kickSpy = vi.spyOn(game, "kickClient");

    const { client: admin, ws: adminWs } = makeClient(
      "admin001",
      "admin-pid",
      "admin",
    );
    const { client: target } = makeClient("target01", "target-pid");

    game.joinClient(admin);
    game.joinClient(target);

    await sendKickMessage(adminWs, "target01");

    expect(kickSpy).toHaveBeenCalledOnce();
    expect(kickSpy).toHaveBeenCalledWith("target01", "kick_reason.admin");
  });

  it("non-creator non-admin cannot kick", async () => {
    const game = makeGame("creator-pid");
    const kickSpy = vi.spyOn(game, "kickClient");

    const { client: creator } = makeClient("creator1", "creator-pid");
    const { client: rando, ws: randoWs } = makeClient("rando001", "rando-pid");
    const { client: target } = makeClient("target01", "target-pid");

    game.joinClient(creator);
    game.joinClient(rando);
    game.joinClient(target);

    await sendKickMessage(randoWs, "target01");

    expect(kickSpy).not.toHaveBeenCalled();
  });

  it("cannot kick yourself even as lobby creator", async () => {
    const game = makeGame("creator-pid");
    const kickSpy = vi.spyOn(game, "kickClient");

    const { client: creator, ws: creatorWs } = makeClient(
      "creator1",
      "creator-pid",
    );
    game.joinClient(creator);

    await sendKickMessage(creatorWs, "creator1");

    expect(kickSpy).not.toHaveBeenCalled();
  });
});
