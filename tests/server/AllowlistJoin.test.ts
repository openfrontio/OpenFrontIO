import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/Schemas", async () => {
  const actual = (await vi.importActual("../../src/core/Schemas")) as any;
  return {
    ...actual,
    GameStartInfoSchema: {
      safeParse: (data: any) => ({ success: true, data }),
    },
    ServerPrestartMessageSchema: {
      safeParse: (data: any) => ({ success: true, data }),
    },
    ClientMessageSchema: {
      safeParse: (data: any) => ({ success: true, data }),
    },
  };
});

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
  persistentID: string,
  publicId: string | undefined,
): Client {
  return new Client(
    clientID,
    persistentID,
    null,
    null,
    undefined,
    "127.0.0.1",
    "TestUser",
    null,
    makeMockWs() as any,
    undefined,
    publicId,
    [],
  );
}

describe("GameServer - allowlist (allowedPublicIds)", () => {
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
    vi.useRealTimers();
  });

  function makeGame(allowedPublicIds?: string[]) {
    return new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
      ...(allowedPublicIds ? { allowedPublicIds } : {}),
    } as any);
  }

  it("admits only listed publicIds and rejects others", () => {
    const game = makeGame(["pub-ok"]);
    expect(game.joinClient(makeClient("c1", "p1", "pub-ok"))).toBe("joined");
    expect(game.joinClient(makeClient("c2", "p2", "pub-no"))).toBe(
      "not_allowlisted",
    );
    expect(game.joinClient(makeClient("c3", "p3", undefined))).toBe(
      "not_allowlisted",
    );
  });

  it("does not restrict joins when no allowlist is set", () => {
    const game = makeGame();
    expect(game.joinClient(makeClient("c1", "p1", "anything"))).toBe("joined");
  });

  it("treats an empty allowlist as no restriction", () => {
    const game = makeGame([]);
    expect(game.joinClient(makeClient("c1", "p1", "anything"))).toBe("joined");
  });

  it("lets a previously-rejected player in once the allowlist is cleared", () => {
    const game = makeGame(["pub-ok"]);
    expect(game.joinClient(makeClient("c2", "p2", "pub-no"))).toBe(
      "not_allowlisted",
    );
    game.updateGameConfig({ allowedPublicIds: [] });
    expect(game.joinClient(makeClient("c2", "p2", "pub-no"))).toBe("joined");
  });

  it("keeps allowedPublicIds on the stored config (read like other settings)", () => {
    const game = makeGame(["pub-ok"]);
    expect((game.gameConfig as any).allowedPublicIds).toEqual(["pub-ok"]);
  });
});
