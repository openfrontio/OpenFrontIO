import { GameType } from "@openfront/engine-api/game/GameTypes";
import { ADMIN_BOT_CLIENT_ID } from "@openfront/engine-api/Schemas";
import { GameEnv } from "@openfront/shared/configuration/Env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerEnv } from "../../src/server/ServerEnv";
import { createAdmissionGuard } from "../../src/server/Worker";
import {
  cid,
  makeClient,
  makeGame,
  makeMockWs,
  mockLogger,
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

    // The evicted session's record stays known to the game with the same
    // persistentID and publicId. Kicking it must cut off
    // the session that replaced it, not ban the account while leaving that
    // session connected (and every later kick returning "already kicked").
    describe("kicking the account after a duplicate replacement", () => {
      const withPublicId = (tag: string) =>
        makeClient({
          clientID: cid(tag),
          persistentID: "acct-pid",
          publicId: "pubACCT1",
        });

      it("cuts off the live session when the evicted record is kicked", () => {
        vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
        const game = makeGame();
        const first = withPublicId("first");
        const second = withPublicId("second");
        game.joinClient(first);
        game.joinClient(second);

        game.kickClient(cid("first"), "kick_reason.admin");

        expect(mockWsOf(second).close).toHaveBeenCalledWith(
          1000,
          "kick_reason.admin",
        );
        expect(game.numClients()).toBe(0);
        expect(game.joinClient(withPublicId("third"))).toBe("kicked");
      });

      it("cuts off the live session on an admin kick by publicId", () => {
        vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
        const game = makeGame();
        const second = withPublicId("second");
        game.joinClient(withPublicId("first"));
        game.joinClient(second);

        const result = game.handleIntent(
          { type: "kick_player", targetPublicID: "pubACCT1" } as any,
          {
            clientID: ADMIN_BOT_CLIENT_ID,
            isLobbyCreator: false,
            isAdmin: true,
            isAdminBot: true,
          },
        );

        expect(result.status).toBe(200);
        expect(mockWsOf(second).close).toHaveBeenCalledWith(
          1000,
          "kick_reason.admin",
        );
        expect(game.numClients()).toBe(0);
      });
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

  describe("full lobby", () => {
    it("rejects a late joiner with full-lobby, at debug rather than warn", () => {
      const log = mockLogger();
      const game = makeGame({
        config: { gameType: GameType.Public, maxPlayers: 2 },
        log,
      });
      expect(game.joinClient(makeClient({ clientID: cid("a") }))).toBe(
        "joined",
      );
      expect(game.joinClient(makeClient({ clientID: cid("b") }))).toBe(
        "joined",
      );
      const late = makeClient({ clientID: cid("c") });
      expect(game.joinClient(late)).toBe("rejected");
      expect(mockWsOf(late).sent()).toContainEqual({
        type: "error",
        error: "full-lobby",
      });
      expect(game.numClients()).toBe(2);
      // Every filled public lobby turns away a stream of late joiners; this
      // is routine, not something worth a warn line per attempt.
      expect(log.warn).not.toHaveBeenCalled();
      expect(log.debug).toHaveBeenCalledWith(
        expect.stringContaining("cannot add client, game full"),
        expect.objectContaining({ clientID: cid("c") }),
      );
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

  it("turns away a genuine late arrival just after game start", () => {
    const game = makeGame();
    const player = makeClient({ clientID: cid("p1"), persistentID: "p1-pid" });
    game.joinClient(player);

    startGame(game);

    const lateClient = makeClient({
      clientID: cid("late"),
      persistentID: "late-pid",
    });
    expect(game.joinClient(lateClient)).toBe("started");
    expect(lateClient.spectator).toBe(false);
    expect(game.getClientIdForPersistentId("late-pid")).toBeNull();
  });

  it("records admission via markAdmitted before seating and reports true via wasAdmitted", () => {
    const game = makeGame();
    const pid = "test-gs-pre-admit";
    expect(game.wasAdmitted(pid)).toBe(false);
    game.markAdmitted(pid);
    expect(game.wasAdmitted(pid)).toBe(true);
  });

  it("removes admission via unmarkAdmitted and reports false via wasAdmitted", () => {
    const game = makeGame();
    const pid = "test-gs-unmark-admit";
    game.markAdmitted(pid);
    expect(game.wasAdmitted(pid)).toBe(true);
    game.unmarkAdmitted(pid);
    expect(game.wasAdmitted(pid)).toBe(false);
  });

  it("handles unmarkAdmitted on non-admitted ID and allows re-admission", () => {
    const game = makeGame();
    const pid = "test-gs-unmark-noop";
    expect(game.wasAdmitted(pid)).toBe(false);
    game.unmarkAdmitted(pid);
    expect(game.wasAdmitted(pid)).toBe(false);
    game.markAdmitted(pid);
    expect(game.wasAdmitted(pid)).toBe(true);
    game.unmarkAdmitted(pid);
    expect(game.wasAdmitted(pid)).toBe(false);
  });

  it("unmarks admission when joinClient fails on started game", () => {
    const game = makeGame();
    const pid = "test-gs-unmark-failed-join";
    game.markAdmitted(pid);
    expect(game.wasAdmitted(pid)).toBe(true);
    const client = makeClient({
      clientID: cid("fail1"),
      persistentID: pid,
    });
    game.start();
    const result = game.joinClient(client);
    expect(result).not.toBe("joined");
    game.unmarkAdmitted(pid);
    expect(game.wasAdmitted(pid)).toBe(false);
  });

  it("maintains wasAdmitted when an admitted seated player leaves the lobby and a subsequent join fails authorization", () => {
    const game = makeGame();
    const pid = "seated-leaving-pid";
    const client = makeClient({ clientID: cid("p1"), persistentID: pid });

    game.markAdmitted(pid);
    expect(game.joinClient(client)).toBe("joined");
    expect(game.wasAdmitted(pid)).toBe(true);

    // Player leaves the lobby before game starts (triggers forgetReconnect)
    mockWsOf(client).trigger("close");
    expect(game.getClientIdForPersistentId(pid)).toBeNull();
    expect(game.wasAdmitted(pid)).toBe(true);

    // Subsequent join attempt: worker evaluates isReadmit and creates guard
    const isReadmit = game.wasAdmitted(pid);
    expect(isReadmit).toBe(true);
    const admissionGuard = createAdmissionGuard(game, pid, isReadmit);

    // The attempt reaches verify or skips it, then markAdmittedIfNeeded is called
    admissionGuard.markAdmittedIfNeeded();
    expect(admissionGuard.wasAdmittedThisAttempt()).toBe(false);

    // Authorization fails downstream (e.g. getUserMe error or forbidden)
    admissionGuard.rollback();

    // Admission from earlier join is preserved
    expect(game.wasAdmitted(pid)).toBe(true);
  });

  it("maintains wasAdmitted when an admitted player leaves the lobby and subsequent joinClient fails", () => {
    const game = makeGame();
    const pid = "seated-leaving-started-pid";
    const client1 = makeClient({ clientID: cid("p1"), persistentID: pid });
    game.markAdmitted(pid);
    expect(game.joinClient(client1)).toBe("joined");

    // Player leaves before start
    mockWsOf(client1).trigger("close");
    expect(game.wasAdmitted(pid)).toBe(true);

    // Game starts in their absence
    game.start();

    // Rejoin attempt creates guard with isReadmit: true
    const isReadmit = game.wasAdmitted(pid);
    const guard = createAdmissionGuard(game, pid, isReadmit);
    guard.markAdmittedIfNeeded();

    // joinClient is rejected because game started without them
    const client2 = makeClient({ clientID: cid("p2"), persistentID: pid });
    const joinResult = game.joinClient(client2);
    expect(joinResult).not.toBe("joined");

    if (joinResult !== "joined" && joinResult !== "redirected") {
      guard.rollback();
    }

    expect(game.wasAdmitted(pid)).toBe(true);
  });

  it("maintains wasAdmitted when concurrent Attempt A rolls back tentative admission after Attempt B seated and left the lobby", () => {
    const game = makeGame();
    const pid = "concurrent-race-pid";

    // Attempt A arrives first when not yet admitted
    const guardA = createAdmissionGuard(game, pid, game.wasAdmitted(pid));
    guardA.markAdmittedIfNeeded();
    expect(guardA.wasAdmittedThisAttempt()).toBe(true);
    expect(game.wasAdmitted(pid)).toBe(true);

    // Concurrent Attempt B seats successfully
    const clientB = makeClient({ clientID: cid("pB"), persistentID: pid });
    expect(game.joinClient(clientB)).toBe("joined");

    // Client B leaves the lobby before game starts (triggers forgetReconnect)
    mockWsOf(clientB).trigger("close");
    expect(game.getClientIdForPersistentId(pid)).toBeNull();
    expect(game.wasAdmitted(pid)).toBe(true);

    // Downstream failure causes Attempt A to rollback its tentative admission
    guardA.rollback();

    // Because client B was seated, admission is preserved despite Attempt A's rollback
    expect(game.wasAdmitted(pid)).toBe(true);
  });

  it("protects admission when two concurrent unseated guards share a persistentId and the first rolls back", () => {
    const game = makeGame();
    const pid = "concurrent-unseated-guard-pid";

    // Attempt A arrives first when not yet admitted
    const isReadmitA = game.wasAdmitted(pid);
    expect(isReadmitA).toBe(false);
    const guardA = createAdmissionGuard(game, pid, isReadmitA, "attempt-A");
    guardA.markAdmittedIfNeeded();
    expect(guardA.wasAdmittedThisAttempt()).toBe(true);
    expect(game.wasAdmitted(pid)).toBe(true);
    expect(game.hasEverBeenSeated(pid)).toBe(false);

    // Attempt B arrives concurrently before Attempt A is seated
    const isReadmitB = game.wasAdmitted(pid);
    expect(isReadmitB).toBe(true);
    const guardB = createAdmissionGuard(game, pid, isReadmitB, "attempt-B");
    guardB.markAdmittedIfNeeded();
    expect(guardB.wasAdmittedThisAttempt()).toBe(true);
    expect(game.wasAdmitted(pid)).toBe(true);
    expect(game.hasEverBeenSeated(pid)).toBe(false);

    // Attempt A rolls back (e.g. getUserMe failure)
    guardA.rollback();
    expect(guardA.wasAdmittedThisAttempt()).toBe(false);
    // Admission remains protected because Attempt B is still pending
    expect(game.wasAdmitted(pid)).toBe(true);

    // Attempt B rolls back
    guardB.rollback();
    expect(guardB.wasAdmittedThisAttempt()).toBe(false);
    // All pending unseated attempts rolled back, admission cleared
    expect(game.wasAdmitted(pid)).toBe(false);
  });
});
