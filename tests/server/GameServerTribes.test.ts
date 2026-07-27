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

vi.mock("../../src/server/CustomTribes", () => ({
  fetchCustomTribes: vi.fn(),
}));

import { GameType } from "../../src/core/game/Game";
import { fetchCustomTribes } from "../../src/server/CustomTribes";
import { GameServer } from "../../src/server/GameServer";

function fakeClient(clientID: string, publicId?: string) {
  return {
    clientID,
    persistentID: `persist-${clientID}`,
    publicId,
    friends: [],
    username: clientID,
    clanTag: null,
    role: null,
    cosmetics: undefined,
    ws: { readyState: 3, send: vi.fn() },
  } as any;
}

// Lets the fetchCustomTribes .then/.catch chain in fetchTribes() settle.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("GameServer custom tribes", () => {
  let mockLogger: any;

  beforeEach(() => {
    // restoreAllMocks doesn't touch vi.mock module mocks — reset the fetch
    // mock's implementation and call history between tests explicitly.
    vi.mocked(fetchCustomTribes).mockReset();
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

  function makeGame(config: Record<string, unknown> = {}) {
    return new GameServer("testgame", mockLogger, Date.now(), {
      gameType: GameType.Public,
      gameMap: "plains",
      gameMapSize: 100,
      bots: 400,
      ...config,
    } as any);
  }

  it("fetches the pool at prestart and embeds the tribes in the start info", async () => {
    vi.mocked(fetchCustomTribes).mockResolvedValue([
      "Dragon Riders",
      "Night Wolves",
    ]);
    const game = makeGame();
    game.activeClients.push(
      fakeClient("abcd1234", "pub-1"),
      fakeClient("efgh5678"), // guest — no account, must be omitted
    );

    game.prestart();
    await flushMicrotasks();
    game.start();

    expect(fetchCustomTribes).toHaveBeenCalledWith([
      { clientId: "abcd1234", publicId: "pub-1" },
    ]);
    expect((game as any).gameStartInfo.tribes).toEqual([
      "Dragon Riders",
      "Night Wolves",
    ]);
  });

  it("drops tribes from the tail when there are fewer bots", async () => {
    vi.mocked(fetchCustomTribes).mockResolvedValue([
      "Dragon Riders",
      "Night Wolves",
    ]);
    const game = makeGame({ bots: 1 });

    game.prestart();
    await flushMicrotasks();
    game.start();

    expect((game as any).gameStartInfo.tribes).toEqual(["Dragon Riders"]);
  });

  it("skips the fetch for non-public games", async () => {
    const game = makeGame({ gameType: GameType.Private });

    game.prestart();
    await flushMicrotasks();
    game.start();

    expect(fetchCustomTribes).not.toHaveBeenCalled();
    expect((game as any).gameStartInfo.tribes).toBeUndefined();
  });

  it("skips the fetch when bots are disabled", async () => {
    const game = makeGame({ bots: 0 });

    game.prestart();
    await flushMicrotasks();

    expect(fetchCustomTribes).not.toHaveBeenCalled();
  });

  it("starts without tribes when the fetch fails", async () => {
    vi.mocked(fetchCustomTribes).mockRejectedValue(new Error("timeout"));
    const game = makeGame();

    game.prestart();
    await flushMicrotasks();
    game.start();

    expect((game as any).gameStartInfo.tribes).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("failed to fetch custom tribes"),
    );
  });

  it("omits tribes from the start info when the pool is empty", async () => {
    vi.mocked(fetchCustomTribes).mockResolvedValue([]);
    const game = makeGame();

    game.prestart();
    await flushMicrotasks();
    game.start();

    expect((game as any).gameStartInfo.tribes).toBeUndefined();
  });
});
