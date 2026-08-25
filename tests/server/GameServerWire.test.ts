import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real finalizeGameRecord so the archived record is snapshotted as
// it would be sent; only the network call is stubbed.
vi.mock("../../src/server/Archive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/Archive")>()),
  archive: vi.fn(),
}));

import { GameMode, GameType } from "../../src/core/game/Game";
import { ClientMessage } from "../../src/core/Schemas";
import { createGameWireContext } from "../../src/core/ZbinWire";
import { archive } from "../../src/server/Archive";
import { ServerEnv } from "../../src/server/ServerEnv";
import {
  cid,
  makeClient,
  makeGame,
  makeMockWs,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Golden transcript: a scripted game, and every frame the server sends each
// client along the way, plus the HTTP lobby view, the live stats, and the
// archived record. Client-visible behaviour is GameServer's contract, so a
// refactor that leaves this snapshot untouched cannot have changed it.
//
// The snapshot is meant to be read when it changes: a diff here is either a
// deliberate wire change (update it) or a regression (don't).

const T0 = 1_700_000_000_000;
const TURN_MS = 100; // ServerEnv.turnIntervalMs()

describe("GameServer wire transcript", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.mocked(archive).mockReset();
    // finalizeGameRecord stamps these from the environment.
    vi.spyOn(ServerEnv, "gitCommit").mockReturnValue("golden-commit");
    vi.spyOn(ServerEnv, "subdomain").mockReturnValue("golden-sub");
    vi.spyOn(ServerEnv, "domain").mockReturnValue("golden.test");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("matches the golden transcript for a scripted game", async () => {
    const HOST = cid("host");
    const P2 = cid("p2");
    const P3 = cid("p3");
    const CAST = cid("cast");

    const game = makeGame({
      id: cid("golden"),
      creatorPersistentID: "host-pid",
      config: { gameType: GameType.Private, maxPlayers: 3 },
    });
    const host = makeClient({
      clientID: HOST,
      persistentID: "host-pid",
      username: "HostName",
      clanTag: "HST",
      ip: "1.1.1.1",
      publicId: "host-pub",
      friends: ["p2-pub"],
    });
    const p2 = makeClient({
      clientID: P2,
      persistentID: "p2-pid",
      username: "SecondOne",
      ip: "2.2.2.2",
      publicId: "p2-pub",
      cosmetics: { verified: true },
    });
    const p3 = makeClient({
      clientID: P3,
      persistentID: "p3-pid",
      username: "ThirdOne",
      clanTag: "TRD",
      ip: "3.3.3.3",
    });
    const cast = makeClient({
      clientID: CAST,
      persistentID: "cast-pid",
      username: "Caster",
      ip: "4.4.4.4",
      spectator: true,
    });

    // p3 reconnects on a new socket later; client.ws then points at that one,
    // so hold on to the original to read what it was sent.
    const p3Ws = mockWsOf(p3);
    const late = makeClient({ clientID: cid("late"), ip: "5.5.5.5" });

    // --- Lobby ---
    expect(game.joinClient(host)).toBe("joined");
    expect(game.joinClient(p2)).toBe("joined");
    expect(game.joinClient(cast)).toBe("joined");
    expect(game.joinClient(p3)).toBe("joined");
    // A fourth player is turned away; the spectator took no seat.
    expect(game.joinClient(late)).toBe("rejected");

    vi.advanceTimersByTime(1000); // one lobby_info broadcast tick

    // The host edits the lobby, then arms the start timer.
    await mockWsOf(host).emit({
      type: "intent",
      intent: {
        type: "update_game_config",
        config: { bots: 5, gameMode: GameMode.FFA },
      },
    });
    await mockWsOf(host).emit({
      type: "intent",
      intent: { type: "toggle_game_start_timer" },
    });
    vi.advanceTimersByTime(1000);

    const lobbyHttpView = game.gameInfo();

    // --- Start ---
    startGame(game);
    // Same roster, same order, as the start message seeds on the client.
    const ctx = createGameWireContext([
      { clientID: HOST },
      { clientID: P2 },
      { clientID: P3 },
    ]);

    // --- Play ---
    await mockWsOf(p2).emit({
      type: "intent",
      intent: { type: "spawn", tile: 1 },
    });
    vi.advanceTimersByTime(TURN_MS); // turn 0
    // A spectator's intent is dropped; p3's lands in turn 1.
    await mockWsOf(cast).emit({
      type: "intent",
      intent: { type: "spawn", tile: 2 },
    });
    await mockWsOf(p3).emit({
      type: "intent",
      intent: { type: "spawn", tile: 3 },
    });
    vi.advanceTimersByTime(TURN_MS); // turn 1

    // Pause flushes its intent into turn 2 at once; the clock then runs
    // without producing turns. Unpausing lands in turn 3.
    await mockWsOf(host).emit({
      type: "intent",
      intent: { type: "toggle_pause", paused: true },
    });
    vi.advanceTimersByTime(3 * TURN_MS);
    await mockWsOf(host).emit({
      type: "intent",
      intent: { type: "toggle_pause", paused: false },
    });

    // Hashes: everyone agrees on turn 0; p3 disagrees on turn 10.
    for (const c of [host, p2, p3]) {
      await mockWsOf(c).emit({ type: "hash", hash: 1234.5, turnNumber: 0 });
    }
    for (const c of [host, p2]) {
      await mockWsOf(c).emit({ type: "hash", hash: 99, turnNumber: 10 });
    }
    await mockWsOf(p3).emit({ type: "hash", hash: 98, turnNumber: 10 });
    // Turns 4..20: the sync check runs at 10 turns (for turn 0) and at 20
    // (for turn 10).
    vi.advanceTimersByTime(17 * TURN_MS);

    // p3's socket drops; they reconnect on a new one asking for turns from 5.
    await p3Ws.trigger("close");
    const p3Again = makeMockWs();
    expect(game.rejoinClient(p3Again as any, "p3-pid", 5)).toBe(true);

    // Live stats consensus from two of three IPs.
    const stats = {
      turn: 10,
      players: [
        {
          clientID: HOST,
          tilesOwned: 10,
          troops: 100,
          gold: "50",
          isAlive: true,
          team: null,
          killedBy: null,
          deathPosition: null,
        },
      ],
    };
    await mockWsOf(host).emit({ type: "live_stats", stats });
    await mockWsOf(p2).emit({ type: "live_stats", stats });

    // Winner: host and p2 vote (2 of 3 IPs); p3 never does.
    const winnerMsg: ClientMessage = {
      type: "winner",
      winner: ["player", HOST],
      allPlayersStats: {},
    };
    await mockWsOf(host).emit(winnerMsg);
    await mockWsOf(p2).emit(winnerMsg);
    expect(archive).toHaveBeenCalledOnce();

    // --- End ---
    await game.end();

    expect({
      lobbyHttpView,
      liveStats: game.liveStats(),
      frames: {
        host: mockWsOf(host).sent(ctx),
        p2: mockWsOf(p2).sent(ctx),
        p3: p3Ws.sent(ctx),
        p3Again: p3Again.sent(ctx),
        cast: mockWsOf(cast).sent(ctx),
        late: mockWsOf(late).sent(),
      },
      closes: {
        host: mockWsOf(host).close.mock.calls,
        p2: mockWsOf(p2).close.mock.calls,
        p3: p3Ws.close.mock.calls,
        p3Again: p3Again.close.mock.calls,
        cast: mockWsOf(cast).close.mock.calls,
      },
      archived: vi.mocked(archive).mock.calls[0][0],
    }).toMatchSnapshot();
  });
});
