import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { ADMIN_BOT_CLIENT_ID } from "../../src/core/Schemas";
import { createGameWireContext } from "../../src/core/ZbinWire";
import { GameServer } from "../../src/server/GameServer";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

describe("GameServer.handleIntent (admin bot)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

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
      const game = makeGame({ config: { bots: 100 } });
      const result = apply(game, {
        type: "update_game_config",
        config: { bots: 42 },
      } as any);
      expect(result.status).toBe(200);
      expect(game.gameInfo().gameConfig?.bots).toBe(42);
    });

    it("rejects a public game with 403", () => {
      const game = makeGame({ config: { gameType: GameType.Public } });
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
      startGame(game);
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
      const game = makeGame({ config: { startDelay: 0 } });
      expect(game.gameInfo().startsAt).toBeUndefined();

      expect(
        apply(game, { type: "toggle_game_start_timer" } as any).status,
      ).toBe(200);
      expect(game.gameInfo().startsAt).toBeDefined();

      expect(
        apply(game, { type: "toggle_game_start_timer" } as any).status,
      ).toBe(200);
      expect(game.gameInfo().startsAt).toBeUndefined();
    });

    it("rejects after the game has started with 409", () => {
      const game = makeGame();
      startGame(game);
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
      const game = makeGame({ config: { gameType: GameType.Public } });
      expect(
        apply(game, {
          type: "kick_player",
          targetClientID: "abcdABCD",
        } as any).status,
      ).toBe(403);
    });

    it("resolves a publicID target to a connected client's clientID", () => {
      const game = makeGame();
      game.joinClient(
        makeClient({ clientID: "liveCID1", publicId: "pubABCD1" }),
      );
      const spy = vi.spyOn(game, "kickClient").mockImplementation(() => {});
      const result = apply(game, {
        type: "kick_player",
        targetPublicID: "pubABCD1",
      } as any);
      expect(result.status).toBe(200);
      expect(spy).toHaveBeenCalledWith("liveCID1", expect.any(String));
    });

    it("kicks a disconnected account by publicID (bans its persistentID)", async () => {
      const game = makeGame();
      // Disconnected: still known to the game but no longer connected after
      // the socket close. Must stay kickable so the persistentID ban fires
      // and blocks a rejoin/reconnect.
      const gone = makeClient({
        clientID: "goneCID1",
        publicId: "pubGONE1",
        persistentID: "persist-gone-1",
      });
      game.joinClient(gone);
      await mockWsOf(gone).trigger("close");
      expect(game.numClients()).toBe(0);

      const result = apply(game, {
        type: "kick_player",
        targetPublicID: "pubGONE1",
      } as any);
      expect(result.status).toBe(200);
      expect(game.wasAdmitted("persist-gone-1")).toBe(false);
      expect(
        game.joinClient(
          makeClient({ clientID: "goneCID2", persistentID: "persist-gone-1" }),
        ),
      ).toBe("kicked");
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
      startGame(game);

      expect(
        apply(game, { type: "toggle_pause", paused: true } as any).status,
      ).toBe(200);
      expect(game.isPaused()).toBe(true);

      expect(
        apply(game, { type: "toggle_pause", paused: false } as any).status,
      ).toBe(200);
      expect(game.isPaused()).toBe(false);
    });

    it("records the pause intent stamped with the placeholder clientID", () => {
      // Read off the turn the pause was committed into, as a player sees it.
      const game = makeGame();
      const player = makeClient({ clientID: cid("p1") });
      game.joinClient(player);
      startGame(game);
      apply(game, { type: "toggle_pause", paused: true } as any);

      const ctx = createGameWireContext([{ clientID: cid("p1") }]);
      const intents = mockWsOf(player)
        .sent(ctx)
        .flatMap((m) => (m.type === "turn" ? m.turn.intents : []));
      const pause = intents.find((i) => i.type === "toggle_pause");
      expect(pause).toBeDefined();
      expect(pause?.clientID).toBe(ADMIN_BOT_CLIENT_ID);
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
