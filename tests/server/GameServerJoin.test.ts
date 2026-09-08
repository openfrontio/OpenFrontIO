import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEnv } from "../../src/core/configuration/Config";
import { GameType } from "../../src/core/game/Game";
import { ServerEnv } from "../../src/server/ServerEnv";
import {
  cid,
  makeClient,
  makeGame,
  makeMockWs,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Characterization tests for joinClient paths that had no coverage: the
// production-only guards (one session per account, three connections per
// IP), a socket that is already dead when it joins, and a frame the server
// cannot decode. They pin current behaviour so the refactor in
// docs/GameServerRefactor.md cannot change it unnoticed.

describe("GameServer.joinClient — environment guards", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("one session per account (prod only)", () => {
    const account = (tag: string) =>
      makeClient({ clientID: cid(tag), persistentID: "acct-pid" });

    it("kicks the existing session and seats the new one", () => {
      vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
      const game = makeGame();
      const first = account("first");
      const second = account("second");
      expect(game.joinClient(first)).toBe("joined");
      expect(game.joinClient(second)).toBe("joined");

      // The OLD connection is the one told to go, so the newest client is the
      // one left holding the game (it may want to replay it afterwards).
      expect(mockWsOf(first).sent()).toContainEqual({
        type: "error",
        error: "kick_reason.duplicate_session",
      });
      expect(mockWsOf(first).close).toHaveBeenCalledWith(
        1000,
        "kick_reason.duplicate_session",
      );
      expect(mockWsOf(first).removeAllListeners).toHaveBeenCalled();
      expect(mockWsOf(second).close).not.toHaveBeenCalled();
      expect(game.numClients()).toBe(1);
      expect(game.gameInfo().clients?.map((c) => c.clientID)).toEqual([
        cid("second"),
      ]);
    });

    it("does not ban the account's persistentID when evicting duplicate session", () => {
      vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
      const game = makeGame();
      game.joinClient(account("first"));
      game.joinClient(account("second"));

      expect(game.getClientIdForPersistentId("acct-pid")).toBe(cid("second"));
      expect(game.wasAdmitted("acct-pid")).toBe(true);
    });

    it("is not enforced outside prod", () => {
      vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Preprod);
      const game = makeGame();
      const first = account("first");
      expect(game.joinClient(first)).toBe("joined");
      expect(game.joinClient(account("second"))).toBe("joined");
      expect(mockWsOf(first).close).not.toHaveBeenCalled();
      expect(game.numClients()).toBe(2);
    });
  });

  describe("three connections per IP (public games, outside dev)", () => {
    const sameIp = (tag: string) =>
      makeClient({ clientID: cid(tag), ip: "9.9.9.9" });

    it("rejects the fourth connection from one IP", () => {
      vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
      const game = makeGame({ config: { gameType: GameType.Public } });
      expect(game.joinClient(sameIp("a"))).toBe("joined");
      expect(game.joinClient(sameIp("b"))).toBe("joined");
      expect(game.joinClient(sameIp("c"))).toBe("joined");
      expect(game.joinClient(sameIp("d"))).toBe("rejected");
      // Another IP is still welcome.
      expect(
        game.joinClient(makeClient({ clientID: cid("e"), ip: "8.8.8.8" })),
      ).toBe("joined");
      expect(game.numClients()).toBe(4);
    });

    it("does not apply to private games", () => {
      vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
      const game = makeGame({ config: { gameType: GameType.Private } });
      for (const tag of ["a", "b", "c", "d"]) {
        expect(game.joinClient(sameIp(tag))).toBe("joined");
      }
    });

    it("is skipped in dev, where multi-tab testing is same-IP", () => {
      vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Dev);
      const game = makeGame({ config: { gameType: GameType.Public } });
      for (const tag of ["a", "b", "c", "d"]) {
        expect(game.joinClient(sameIp(tag))).toBe("joined");
      }
    });
  });
});

describe("GameServer.joinClient — socket already dead on arrival", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("treats a socket that closed before listeners attached as a disconnect", () => {
    // The 'close' event already fired, so the handler registered by
    // addListeners would never run; the join has to notice on its own.
    const game = makeGame();
    const ws = makeMockWs();
    ws.readyState = 3; // CLOSED
    const client = makeClient({
      clientID: cid("dead"),
      persistentID: "dead-pid",
      ws,
    });
    expect(game.joinClient(client)).toBe("joined");

    // ...but they are gone at once: no seat, and no reconnect mapping since
    // the lobby has not started.
    expect(game.numClients()).toBe(0);
    expect(game.getClientIdForPersistentId("dead-pid")).toBeNull();
    // Admission survives, as after any lobby-phase drop.
    expect(game.wasAdmitted("dead-pid")).toBe(true);
  });
});

describe("GameServer — undecodable frame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("kicks the sender with invalid_message and bans the account", async () => {
    const game = makeGame();
    const client = makeClient({
      clientID: cid("bad"),
      persistentID: "bad-pid",
    });
    game.joinClient(client);

    await mockWsOf(client).trigger(
      "message",
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
    );

    expect(mockWsOf(client).sent()).toContainEqual({
      type: "error",
      error: "kick_reason.invalid_message",
    });
    expect(mockWsOf(client).close).toHaveBeenCalledWith(
      1000,
      "kick_reason.invalid_message",
    );
    expect(game.numClients()).toBe(0);
    // A kick is a ban: the same account cannot come back on a new connection.
    expect(
      game.joinClient(
        makeClient({ clientID: cid("bad2"), persistentID: "bad-pid" }),
      ),
    ).toBe("kicked");
  });
});

describe("GameServer.joinClient — active game reconnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("preserves player identity and does not downgrade admitted player to spectator", () => {
    const game = makeGame();
    const original = makeClient({
      clientID: cid("orig"),
      persistentID: "player-pid",
    });
    expect(game.joinClient(original)).toBe("joined");

    startGame(game);

    const newWs = makeMockWs();
    const reconnecting = makeClient({
      clientID: cid("fresh"),
      persistentID: "player-pid",
      ws: newWs,
    });

    expect(game.joinClient(reconnecting)).toBe("joined");

    // Client should retain their mapped clientID and not be downgraded to spectator
    expect(game.getClientIdForPersistentId("player-pid")).toBe(cid("orig"));
    expect(reconnecting.spectator).toBe(false);
    expect(original.spectator).toBe(false);

    // Reconnecting client socket received the start message with original clientID
    const startMsg = newWs.sent().find((m) => (m as any).type === "start");
    expect(startMsg).toBeDefined();
    expect((startMsg as any).myClientID).toBe(cid("orig"));
  });

  it("marks genuine late arrival after game start as spectator", () => {
    const game = makeGame();
    const player = makeClient({ clientID: cid("p1"), persistentID: "p1-pid" });
    game.joinClient(player);

    startGame(game);

    const lateClient = makeClient({
      clientID: cid("late"),
      persistentID: "late-pid",
    });
    expect(game.joinClient(lateClient)).toBe("joined");
    expect(lateClient.spectator).toBe(true);
  });
});
