import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameManager } from "../../src/server/GameManager";
import { GamePhase, GameServer } from "../../src/server/GameServer";
import {
  MatchTelemetryEmitter,
  MatchTelemetryEvent,
  MatchTelemetryType,
  zeroCounters,
} from "../../src/server/telemetry/MatchTelemetry";
import {
  cid,
  makeClient,
  makeGame,
  makeMockWs,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// An empty game must always become Finished so GameManager prunes it.
// A game that auto-started by filling to maxPlayers (or an admin bot game)
// never gets a startsAt, and those used to linger — still ticking turns with
// nobody connected — until the 3 hour maxGameDuration cutoff.
describe("empty game reaping", () => {
  let log: any;

  // Everything the game reaches for is inert in the harness; only the
  // telemetry sink is read, to prove a playerless game never starts.
  class RecordingEmitter implements MatchTelemetryEmitter {
    readonly types: MatchTelemetryType[] = [];
    emit(event: MatchTelemetryEvent) {
      this.types.push(event.type);
      return "enqueued" as const;
    }
    counters() {
      return zeroCounters();
    }
    stop() {}
  }

  // One tick of GameManager's loop, plus the 2s delayed start it schedules.
  const runManager = (ms: number) => vi.advanceTimersByTime(ms);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    log = mockLogger();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("finishes a started, client-less game that has no startsAt", () => {
    const game = makeGame({ log });
    startGame(game);

    expect(game.phase()).toBe(GamePhase.Active);

    vi.advanceTimersByTime(60_000);

    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("finishes a started, client-less game that has a startsAt", () => {
    const game = makeGame({ log, startsAt: Date.now() + 5_000 });
    vi.advanceTimersByTime(5_000);
    startGame(game);

    vi.advanceTimersByTime(60_000);

    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("keeps a just-started game Active through the warmup grace", () => {
    const game = makeGame({ log });
    startGame(game);

    vi.advanceTimersByTime(10_000);

    expect(game.phase()).toBe(GamePhase.Active);
  });

  it("ignores pings from a socket that has left the roster", async () => {
    const game = makeGame({ log });
    const client = makeClient({ clientID: cid("ghost") });
    game.joinClient(client);
    startGame(game);

    // The socket closes but keeps its message listener, as a real one does
    // through its close handshake, and goes on pinging.
    const ws = mockWsOf(client);
    await ws.trigger("close");
    vi.advanceTimersByTime(60_000);
    await ws.emit({ type: "ping" });

    // A ping that refreshed the game-wide clock would hold this at Active.
    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("keeps a game with a connected client running", async () => {
    const game = makeGame({ log });
    const client = makeClient({ clientID: cid("player") });
    game.joinClient(client);
    startGame(game);

    // Well past both the warmup grace and the empty-game timeout.
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(30_000);
      await mockWsOf(client).emit({ type: "ping" });
      game.pruneStaleClients();
      expect(game.phase()).toBe(GamePhase.Active);
    }
  });

  it("finishes a full lobby everyone left before it started", () => {
    const game = makeGame({ log });
    // Reaching maxPlayers arms the auto-start without setting startsAt.
    (game as any).hasReachedMaxPlayerCount = true;

    vi.advanceTimersByTime(60_000);

    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("ends an empty game whose ping clock never goes quiet", () => {
    const telemetry = new RecordingEmitter();
    const manager = new GameManager(log, telemetry);
    const game = manager.createGame(cid("warm"), undefined)!;
    const client = makeClient();
    game.joinClient(client);
    (game as any).hasReachedMaxPlayerCount = true;

    // Started for real by the manager, then abandoned.
    runManager(4_000);
    expect(game.hasStarted()).toBe(true);
    mockWsOf(client).trigger("close");

    // Something keeps the game-wide clock warm with nobody on the roster —
    // the backstop must not depend on that clock.
    const warm = setInterval(
      () => ((game as any).lastPingUpdate = Date.now()),
      1_000,
    );

    runManager(9 * 60_000);
    expect(manager.activeGames()).toBe(1);

    runManager(2 * 60_000);
    expect(manager.activeGames()).toBe(0);
    clearInterval(warm);
  });

  it("does not start a full lobby everyone left, and prunes it", () => {
    const telemetry = new RecordingEmitter();
    const manager = new GameManager(log, telemetry);
    const game = manager.createGame(cid("empty"), undefined)!;
    (game as any).hasReachedMaxPlayerCount = true;
    // The clients who filled the lobby were pinging until the moment they
    // left, so the reap in phase() holds off while that clock is still warm.
    (game as any).lastPingUpdate = Date.now();

    runManager(5_000);

    // Started with an empty roster, this would emit a playerless
    // match_started and run turns for nobody.
    expect(game.hasStarted()).toBe(false);
    expect(telemetry.types).not.toContain("match_started");
    expect(manager.activeGames()).toBe(1);

    // Once the ping clock goes quiet it is pruned instead.
    runManager(30_000);

    expect(game.hasStarted()).toBe(false);
    expect(manager.activeGames()).toBe(0);
  });

  // The roster empties the instant a socket closes, blip or not, so an empty
  // roster when the delayed start comes due is not proof of abandonment.
  describe("a roster that empties during the start delay", () => {
    const prestartedGame = (telemetry: RecordingEmitter) => {
      const manager = new GameManager(log, telemetry);
      const game: GameServer = manager.createGame(cid("delay"), undefined)!;
      const client = makeClient();
      game.joinClient(client);
      (game as any).hasReachedMaxPlayerCount = true;
      // One tick: the lobby is full, so the manager prestarts and schedules
      // start() 2s out.
      runManager(1_000);
      expect(game.hasStarted()).toBe(true);
      expect(telemetry.types).not.toContain("match_started");
      return { manager, game, client };
    };

    it("holds the start rather than running it for nobody", async () => {
      const telemetry = new RecordingEmitter();
      const { manager, client } = prestartedGame(telemetry);

      await mockWsOf(client).trigger("close");
      runManager(3_000);

      expect(telemetry.types).not.toContain("match_started");
      expect(manager.activeGames()).toBe(1);
    });

    it("starts the held game when a dropped client reconnects", async () => {
      const telemetry = new RecordingEmitter();
      const { manager, game, client } = prestartedGame(telemetry);

      // A blip: the socket closes and the client reconnects a moment later,
      // which is what Transport does on any close bar 1000 and 1002.
      await mockWsOf(client).trigger("close");
      runManager(3_000);
      expect(game.rejoinClient(makeMockWs() as any, client.persistentID)).toBe(
        true,
      );

      runManager(1_000);

      expect(telemetry.types).toContain("match_started");
      expect(manager.activeGames()).toBe(1);
    });

    it("reaps the held game if nobody comes back", async () => {
      const telemetry = new RecordingEmitter();
      const { manager, client } = prestartedGame(telemetry);

      await mockWsOf(client).trigger("close");
      runManager(60_000);

      expect(telemetry.types).not.toContain("match_started");
      expect(manager.activeGames()).toBe(0);
    });
  });

  it("ignores messages from a socket that has left the roster", async () => {
    const telemetry = new RecordingEmitter();
    const game = makeGame({ log, telemetry });
    const staying = makeClient({ clientID: cid("stays") });
    const leaving = makeClient({ clientID: cid("leaves") });
    game.joinClient(staying);
    game.joinClient(leaving);
    startGame(game);

    // Its listener outlives the close, as a real socket's does through the
    // handshake — but nothing it sends may still reach the game.
    const ws = mockWsOf(leaving);
    await ws.trigger("close");
    await ws.emit({ type: "intent", intent: { type: "spawn", tile: 1 } });

    expect(telemetry.types).not.toContain("intent_observed");
  });
});
