import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { ADMIN_BOT_CLIENT_ID } from "../../src/core/Schemas";
import { GameServer } from "../../src/server/GameServer";

describe("GameServer.handleIntent (admin bot)", () => {
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

  function makeGame(config: Record<string, unknown> = {}) {
    return new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
      ...config,
    } as any);
  }

  const started = (game: GameServer) => {
    (game as any)._hasStarted = true;
  };

  const ADMIN_ACTOR = {
    clientID: ADMIN_BOT_CLIENT_ID,
    isLobbyCreator: false,
    isAdmin: true,
    isAdminBot: true,
  };
  const apply = (game: GameServer, intent: any) =>
    game.handleIntent(intent, ADMIN_ACTOR);

  describe("update_game_config", () => {
    it("mutates the config", () => {
      const game = makeGame({ bots: 100 });
      const result = apply(game, {
        type: "update_game_config",
        config: { bots: 42 },
      } as any);
      expect(result.status).toBe(200);
      expect((game as any).gameConfig.bots).toBe(42);
    });

    it("rejects a public game with 403", () => {
      const game = makeGame({ gameType: GameType.Public });
      expect(
        apply(game, {
          type: "update_game_config",
          config: { bots: 1 },
        } as any).status,
      ).toBe(403);
    });

    it("rejects promoting a game to public with 400", () => {
      const game = makeGame();
      expect(
        apply(game, {
          type: "update_game_config",
          config: { gameType: GameType.Public },
        } as any).status,
      ).toBe(400);
    });

    it("rejects updates after the game has started with 409", () => {
      const game = makeGame();
      started(game);
      expect(
        apply(game, {
          type: "update_game_config",
          config: { bots: 1 },
        } as any).status,
      ).toBe(409);
    });
  });

  describe("toggle_game_start_timer", () => {
    it("sets then clears startsAt", () => {
      const game = makeGame({ startDelay: 0 });
      expect((game as any).startsAt).toBeUndefined();

      expect(
        apply(game, { type: "toggle_game_start_timer" } as any).status,
      ).toBe(200);
      expect((game as any).startsAt).toBeDefined();

      expect(
        apply(game, { type: "toggle_game_start_timer" } as any).status,
      ).toBe(200);
      expect((game as any).startsAt).toBeUndefined();
    });

    it("rejects after the game has started with 409", () => {
      const game = makeGame();
      started(game);
      expect(
        apply(game, { type: "toggle_game_start_timer" } as any).status,
      ).toBe(409);
    });
  });

  describe("kick_player", () => {
    it("routes to kickClient", () => {
      const game = makeGame();
      const spy = vi.spyOn(game, "kickClient");
      const result = apply(game, {
        type: "kick_player",
        targetClientID: "abcdABCD",
      } as any);
      expect(result.status).toBe(200);
      expect(spy).toHaveBeenCalledWith("abcdABCD", expect.any(String));
    });

    it("rejects a public game with 403", () => {
      const game = makeGame({ gameType: GameType.Public });
      expect(
        apply(game, {
          type: "kick_player",
          targetClientID: "abcdABCD",
        } as any).status,
      ).toBe(403);
    });

    it("resolves a publicID target to a connected client's clientID", () => {
      const game = makeGame();
      // A connected client is in both lists; allClients is the superset we match on.
      const connected = { clientID: "liveCID1", publicId: "pubABCD1" };
      (game as any).activeClients.push(connected);
      (game as any).allClients.set("liveCID1", connected);
      const spy = vi.spyOn(game, "kickClient").mockImplementation(() => {});
      const result = apply(game, {
        type: "kick_player",
        targetPublicID: "pubABCD1",
      } as any);
      expect(result.status).toBe(200);
      expect(spy).toHaveBeenCalledWith("liveCID1", expect.any(String));
    });

    it("kicks a disconnected account by publicID via allClients (bans its persistentID)", () => {
      const game = makeGame();
      // Disconnected: still known to the game (allClients) but already dropped
      // from activeClients on socket close. Must stay kickable so the
      // persistentID ban fires and blocks a rejoin/reconnect.
      (game as any).allClients.set("goneCID1", {
        clientID: "goneCID1",
        publicId: "pubGONE1",
        persistentID: "persist-gone-1",
      });
      const result = apply(game, {
        type: "kick_player",
        targetPublicID: "pubGONE1",
      } as any);
      expect(result.status).toBe(200);
      expect((game as any).kickedPersistentIds.has("persist-gone-1")).toBe(
        true,
      );
    });

    it("404s when no client matches the publicID", () => {
      const game = makeGame();
      expect(
        apply(game, {
          type: "kick_player",
          targetPublicID: "nobodyXX",
        } as any).status,
      ).toBe(404);
    });
  });

  describe("toggle_pause", () => {
    it("rejects when the game has not started with 409", () => {
      const game = makeGame();
      expect(
        apply(game, { type: "toggle_pause", paused: true } as any).status,
      ).toBe(409);
    });

    it("pauses and resumes a started game", () => {
      const game = makeGame();
      started(game);

      expect(
        apply(game, { type: "toggle_pause", paused: true } as any).status,
      ).toBe(200);
      expect((game as any).isPaused).toBe(true);

      expect(
        apply(game, { type: "toggle_pause", paused: false } as any).status,
      ).toBe(200);
      expect((game as any).isPaused).toBe(false);
    });

    it("records the pause intent stamped with the placeholder clientID", () => {
      const game = makeGame();
      started(game);
      apply(game, { type: "toggle_pause", paused: true } as any);

      const intents = (game as any).turns.flatMap((t: any) => t.intents);
      const pause = intents.find((i: any) => i.type === "toggle_pause");
      expect(pause).toBeDefined();
      expect(pause.clientID).toBe(ADMIN_BOT_CLIENT_ID);
    });
  });

  describe("rejected intents", () => {
    it("rejects a gameplay intent with 400", () => {
      const game = makeGame();
      expect(apply(game, { type: "spawn", x: 1, y: 1 } as any).status).toBe(
        400,
      );
    });

    it("rejects mark_disconnected with 400", () => {
      const game = makeGame();
      expect(
        apply(game, {
          type: "mark_disconnected",
          isDisconnected: true,
        } as any).status,
      ).toBe(400);
    });
  });
});
