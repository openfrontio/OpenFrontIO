import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../../src/core/Schemas";
import { createGameWireContext } from "../../src/core/ZbinWire";
import {
  cid,
  makeClient,
  makeGame,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// OPE-423. The per-game grouping token the desktop shell publishes as a Steam
// player group: one value per game, the same for every participant, random
// rather than derived from the game id (which is a private lobby's join
// secret), and never written anywhere a human or a log sink can read it.

const T0 = 1_700_000_000_000;

// Collect the token off whatever frames a socket received, in order.
function tokensSentTo(
  ws: { sent: (ctx?: any) => ServerMessage[] },
  ctx?: any,
): { type: string; groupToken?: string }[] {
  return ws
    .sent(ctx)
    .filter((m) => m.type === "lobby_info" || m.type === "start")
    .map((m) => ({
      type: m.type,
      groupToken: (m as { groupToken?: string }).groupToken,
    }));
}

describe("GameServer group token", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("is 16 URL-safe characters", () => {
    const game = makeGame({ id: cid("shape") });
    const client = makeClient({ clientID: cid("p1") });
    game.joinClient(client);
    vi.advanceTimersByTime(1000);

    const [first] = tokensSentTo(mockWsOf(client));
    expect(first.groupToken).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  // The token exists precisely so that something outside the game can say
  // "these players are together" without being handed the game id. If it were
  // a hash (or any other function) of the id, two games sharing an id would
  // share a token — and anyone holding a token would hold a head start on the
  // id of a private lobby.
  it("is not derived from the game id: same id, different tokens", () => {
    const tokens = [cid("same"), cid("same")].map((id) => {
      const game = makeGame({ id });
      const client = makeClient();
      game.joinClient(client);
      vi.advanceTimersByTime(1000);
      return tokensSentTo(mockWsOf(client))[0].groupToken;
    });

    expect(tokens[0]).toBeDefined();
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it("gives every lobby participant, spectators included, the same token", () => {
    const game = makeGame({ id: cid("lobby") });
    const host = makeClient({
      clientID: cid("host"),
      persistentID: "host-pid",
    });
    const player = makeClient({ clientID: cid("p2") });
    const spectator = makeClient({ clientID: cid("cast"), spectator: true });
    [host, player, spectator].forEach((c) => game.joinClient(c));

    vi.advanceTimersByTime(1000);

    const seen = [host, player, spectator].map(
      (c) => tokensSentTo(mockWsOf(c))[0],
    );
    expect(seen.map((s) => s.type)).toEqual([
      "lobby_info",
      "lobby_info",
      "lobby_info",
    ]);
    expect(seen[0].groupToken).toBeDefined();
    expect(new Set(seen.map((s) => s.groupToken)).size).toBe(1);
  });

  it("repeats the same token in the start message every client gets", () => {
    const game = makeGame({ id: cid("start") });
    const player = makeClient({ clientID: cid("p1") });
    const spectator = makeClient({ clientID: cid("cast"), spectator: true });
    [player, spectator].forEach((c) => game.joinClient(c));
    vi.advanceTimersByTime(1000);

    startGame(game);

    const frames = [player, spectator].map((c) => tokensSentTo(mockWsOf(c)));
    for (const perClient of frames) {
      const start = perClient.filter((f) => f.type === "start");
      expect(start).toHaveLength(1);
      // The lobby broadcasts and the start message are the same group.
      expect(start[0].groupToken).toBe(perClient[0].groupToken);
    }
    const lastOf = (f: { groupToken?: string }[]) => f[f.length - 1].groupToken;
    expect(lastOf(frames[0])).toBe(lastOf(frames[1]));
  });

  // A late joiner never sees a lobby_info — the broadcast stopped before they
  // connected — so the start message is their only chance at the token.
  it("gives a late joiner the token in its catch-up start message", () => {
    const game = makeGame({ id: cid("late") });
    const player = makeClient({ clientID: cid("p1") });
    game.joinClient(player);
    vi.advanceTimersByTime(1000);
    startGame(game);
    const expected = tokensSentTo(mockWsOf(player))[0].groupToken;

    const latecomer = makeClient({ clientID: cid("p2") });
    game.joinClient(latecomer);

    const ctx = createGameWireContext([{ clientID: cid("p1") }]);
    const received = tokensSentTo(mockWsOf(latecomer), ctx);
    expect(received.map((r) => r.type)).toContain("start");
    expect(received.find((r) => r.type === "start")!.groupToken).toBe(expected);
    expect(expected).toBeDefined();
  });

  // The whole point of an opaque token is that holding it means something.
  // A log line is a copy of it in a file, a shipper, and a support ticket.
  it("never writes the token to a log or the console", () => {
    const log = mockLogger();
    const consoleSpies = (
      ["log", "info", "warn", "error", "debug"] as const
    ).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));

    const game = makeGame({ id: cid("quiet"), log });
    const player = makeClient({ clientID: cid("p1") });
    const spectator = makeClient({ clientID: cid("cast"), spectator: true });
    [player, spectator].forEach((c) => game.joinClient(c));
    vi.advanceTimersByTime(3000);
    startGame(game);
    game.joinClient(makeClient({ clientID: cid("p2") }));

    const token = tokensSentTo(mockWsOf(player))[0].groupToken!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{16}$/);

    const written = [
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
      ...log.debug.mock.calls,
      ...consoleSpies.flatMap((s) => s.mock.calls),
    ];
    // Something must actually have been logged, or this asserts nothing.
    expect(written.length).toBeGreaterThan(0);
    for (const call of written) {
      expect(JSON.stringify(call)).not.toContain(token);
    }

    consoleSpies.forEach((s) => s.mockRestore());
  });
});
