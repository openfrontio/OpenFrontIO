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

function makeClient(id: string, spectator = false): Client {
  return new Client(
    id,
    `${id}-pid`,
    null,
    null,
    undefined,
    "127.0.0.1",
    id,
    null,
    makeMockWs() as any,
    undefined,
    `${id}-pub`,
    [],
    spectator,
  );
}

describe("GameServer - spectators", () => {
  let logger: any;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const makeGame = (maxPlayers?: number) =>
    new GameServer("g1", logger, Date.now(), {
      gameType: GameType.Private,
      maxPlayers,
    } as any);

  it("takes no lobby slot, so a full game is still watchable", () => {
    const game = makeGame(2);
    expect(game.joinClient(makeClient("p1"))).toBe("joined");
    expect(game.joinClient(makeClient("p2"))).toBe("joined");
    expect(game.joinClient(makeClient("p3"))).toBe("rejected");
    expect(game.joinClient(makeClient("cast", true))).toBe("joined");
  });

  it("does not let a spectator use up a seat a player could have had", () => {
    const game = makeGame(2);
    expect(game.joinClient(makeClient("cast", true))).toBe("joined");
    expect(game.joinClient(makeClient("p1"))).toBe("joined");
    expect(game.joinClient(makeClient("p2"))).toBe("joined");
  });

  it("is left out of the player list handed to the simulation", () => {
    // Anyone in gameStartInfo.players gets spawned, so a spectator in that list
    // would be playing.
    const game = makeGame();
    game.joinClient(makeClient("p1"));
    game.joinClient(makeClient("cast", true));
    game.start();
    const info = (game as any).gameStartInfo;
    expect(info).toBeDefined();
    expect(info.players.map((p: any) => p.clientID)).toEqual(["p1"]);
  });

  it("still has to be on the allowlist when the lobby sets one", () => {
    // Taking no slot must not become a way around the allowlist.
    const game = new GameServer("g1", logger, Date.now(), {
      gameType: GameType.Private,
      allowedPublicIds: ["p1-pub"],
    } as any);
    expect(game.joinClient(makeClient("cast", true))).toBe("not_allowlisted");
    expect(game.joinClient(makeClient("p1", true))).toBe("joined");
  });

  it("may join after the game has started", () => {
    // A caster arriving mid-game is the normal case; a late player already
    // gets the same treatment, so this only has to keep working.
    const game = makeGame();
    (game as any)._hasStarted = true;
    expect(game.joinClient(makeClient("cast", true))).toBe("joined");
  });
});
