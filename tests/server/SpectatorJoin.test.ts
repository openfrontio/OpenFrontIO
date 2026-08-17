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

import { GameType, RankedType } from "../../src/core/game/Game";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";

function makeMockWs() {
  const handlers = new Map<string, (msg: string) => void>();
  return {
    on: (event: string, fn: (msg: string) => void) => handlers.set(event, fn),
    removeAllListeners: () => handlers.clear(),
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
    /** Drive the socket the way a connected client would. */
    emit: (msg: unknown) => handlers.get("message")?.(JSON.stringify(msg)),
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

  it("does not keep a ranked match alive on its own", () => {
    // 1v1 with one player and one spectator is a one-player game, so the
    // short-handed cancel has to see through the spectator.
    const game = new GameServer("g1", logger, Date.now(), {
      gameType: GameType.Private,
      maxPlayers: 2,
      rankedType: RankedType.OneVOne,
    } as any);
    game.joinClient(makeClient("p1"));
    game.joinClient(makeClient("cast", true));
    expect((game as any).cancelShortHandedMatch()).toBe(true);
  });

  it.each(["intent", "winner", "live_stats"])(
    "drops a %s sent by a spectator",
    async (type) => {
      // Taking no slot must not buy a way into the intent stream.
      const game = makeGame();
      const spies = {
        intent: vi.spyOn(game as any, "handleIntent"),
        winner: vi.spyOn(game as any, "handleWinner"),
        live_stats: vi.spyOn(game as any, "handleLiveStats"),
      };
      const spectator = makeClient("cast", true);
      game.joinClient(spectator);
      await (spectator.ws as any).emit({ type, intent: { type: "spawn" } });
      expect(spies[type as keyof typeof spies]).not.toHaveBeenCalled();
    },
  );

  it("still handles those messages from a player", async () => {
    const game = makeGame();
    const handleIntent = vi.spyOn(game as any, "handleIntent");
    const player = makeClient("p1");
    game.joinClient(player);
    await (player.ws as any).emit({
      type: "intent",
      intent: { type: "spawn" },
    });
    expect(handleIntent).toHaveBeenCalled();
  });

  it("may join after the game has started", () => {
    // A caster arriving mid-game is the normal case; a late player already
    // gets the same treatment, so this only has to keep working.
    const game = makeGame();
    (game as any)._hasStarted = true;
    expect(game.joinClient(makeClient("cast", true))).toBe("joined");
  });
});
