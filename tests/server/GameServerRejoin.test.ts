import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameWireContext } from "../../src/core/ZbinWire";
import {
  cid,
  makeClient,
  makeGame,
  makeMockWs,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Characterization tests for rejoinClient: socket hand-over, the pre-start
// identity update (and the verified badge it may cost), and the turn replay
// a mid-game reconnect receives. See docs/GameServerRefactor.md, Phase 1.

const P1 = cid("p1");
const TURN_MS = 100;

describe("GameServer.rejoinClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("returns false for a persistentID that never joined", () => {
    expect(makeGame().rejoinClient(makeMockWs() as any, "nobody")).toBe(false);
  });

  it("moves the client onto the new socket and closes the old one", () => {
    const game = makeGame();
    const client = makeClient({ clientID: P1, persistentID: "p1-pid" });
    const oldWs = mockWsOf(client);
    game.joinClient(client);

    const newWs = makeMockWs();
    expect(game.rejoinClient(newWs as any, "p1-pid")).toBe(true);

    expect(oldWs.close).toHaveBeenCalledOnce();
    expect(client.ws).toBe(newWs);
    // One seat, not two.
    expect(game.numClients()).toBe(1);
    // Lobby traffic now reaches the new socket.
    vi.advanceTimersByTime(1000);
    expect(newWs.sent().map((m) => m.type)).toContain("lobby_info");
  });

  it("refuses a kicked player", () => {
    const game = makeGame();
    game.joinClient(makeClient({ clientID: P1, persistentID: "p1-pid" }));
    game.kickClient(P1);
    expect(game.rejoinClient(makeMockWs() as any, "p1-pid")).toBe(false);
  });

  describe("identity update", () => {
    it("applies a screened username / clan change before the start", () => {
      const game = makeGame();
      const client = makeClient({
        clientID: P1,
        persistentID: "p1-pid",
        username: "OldName",
        clanTag: "OLD",
      });
      game.joinClient(client);

      game.rejoinClient(makeMockWs() as any, "p1-pid", 0, {
        username: "NewName",
        clanTag: "NEW",
      });

      expect(game.storedIdentity("p1-pid")).toEqual({
        username: "NewName",
        clanTag: "NEW",
      });
      const seen = game.gameInfo().clients?.find((c) => c.clientID === P1);
      expect(seen?.username).toBe("NewName");
      expect(seen?.clanTag).toBe("NEW");
    });

    it("drops the verified badge when the username changes", () => {
      // The badge vouches for the exact join name; the rejoin path skips the
      // Worker's badge validation, so a rename under it must lose it.
      const game = makeGame();
      const client = makeClient({
        clientID: P1,
        persistentID: "p1-pid",
        username: "OldName",
        cosmetics: { verified: true },
      });
      game.joinClient(client);

      game.rejoinClient(makeMockWs() as any, "p1-pid", 0, {
        username: "NewName",
        clanTag: null,
      });

      expect(client.cosmetics?.verified).toBeUndefined();
      const seen = game.gameInfo().clients?.find((c) => c.clientID === P1);
      expect(seen?.verified).toBeUndefined();
    });

    it("keeps the verified badge when only the clan tag changes", () => {
      const game = makeGame();
      const client = makeClient({
        clientID: P1,
        persistentID: "p1-pid",
        username: "SameName",
        clanTag: "OLD",
        cosmetics: { verified: true },
      });
      game.joinClient(client);

      game.rejoinClient(makeMockWs() as any, "p1-pid", 0, {
        username: "SameName",
        clanTag: "NEW",
      });

      expect(client.cosmetics?.verified).toBe(true);
      expect(game.storedIdentity("p1-pid")?.clanTag).toBe("NEW");
    });

    it("is ignored once the game has started", () => {
      // The roster is frozen in gameStartInfo; a later rename would make the
      // lobby record disagree with what every client was told.
      const game = makeGame();
      const client = makeClient({
        clientID: P1,
        persistentID: "p1-pid",
        username: "OldName",
        clanTag: "OLD",
      });
      game.joinClient(client);
      startGame(game);

      expect(
        game.rejoinClient(makeMockWs() as any, "p1-pid", 0, {
          username: "NewName",
          clanTag: "NEW",
        }),
      ).toBe(true);

      expect(game.storedIdentity("p1-pid")).toEqual({
        username: "OldName",
        clanTag: "OLD",
      });
    });
  });

  describe("after the start", () => {
    function playedGame(turns: number) {
      const game = makeGame();
      const client = makeClient({ clientID: P1, persistentID: "p1-pid" });
      game.joinClient(client);
      startGame(game);
      vi.advanceTimersByTime(turns * TURN_MS);
      const ctx = createGameWireContext([{ clientID: P1 }]);
      return { game, client, ctx };
    }

    const startFrameOn = (ws: ReturnType<typeof makeMockWs>, ctx: any) => {
      const start = ws.sent(ctx).find((m) => m.type === "start");
      if (start?.type !== "start") throw new Error("no start frame");
      return start;
    };

    it("replays only the turns the client missed, from lastTurn", () => {
      const { game, ctx } = playedGame(5);
      const newWs = makeMockWs();
      expect(game.rejoinClient(newWs as any, "p1-pid", 3)).toBe(true);

      const start = startFrameOn(newWs, ctx);
      expect(start.turns.map((t) => t.turnNumber)).toEqual([3, 4]);
      expect(start.myClientID).toBe(P1);
    });

    it("replays the whole game when lastTurn is omitted", () => {
      const { game, ctx } = playedGame(5);
      const newWs = makeMockWs();
      game.rejoinClient(newWs as any, "p1-pid");

      expect(startFrameOn(newWs, ctx).turns.map((t) => t.turnNumber)).toEqual([
        0, 1, 2, 3, 4,
      ]);
    });

    it("keeps the reconnect mapping across a mid-game socket drop", async () => {
      // Only a LOBBY-phase drop clears the mapping (to free the seat); once
      // the game runs, the seat is theirs to come back to.
      const { game, client, ctx } = playedGame(2);
      await mockWsOf(client).trigger("close");
      expect(game.numClients()).toBe(0);
      expect(game.getClientIdForPersistentId("p1-pid")).toBe(P1);

      const newWs = makeMockWs();
      expect(game.rejoinClient(newWs as any, "p1-pid", 0)).toBe(true);
      expect(game.numClients()).toBe(1);
      expect(startFrameOn(newWs, ctx).turns).toHaveLength(2);
    });
  });
});
