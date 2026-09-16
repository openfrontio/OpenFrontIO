import EventEmitter from "events";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { CloseCode } from "../../src/core/CloseCodes";
import {
  COORDINATOR_STALE_MS,
  CoordinatorCloseCode,
  CoordinatorHandlers,
  CoordinatorSocket,
  coordinatorUrl,
  LobbyCoordinatorClient,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  RECONNECT_SLOW_MS,
  REPORT_HEARTBEAT_MS,
  SOCKET_SILENCE_MS,
} from "../../src/server/LobbyCoordinatorClient";

// The master's socket to its site's lobby coordinator (infra
// docs/lobby-coordinator.md). These drive the client with a fake socket and
// fake timers: what it sends, when it counts the coordinator as alive, and
// how it comes back after every kind of drop.

class FakeSocket extends EventEmitter implements CoordinatorSocket {
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  terminated = false;
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  terminate() {
    this.terminated = true;
  }
  messages(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }
  receive(msg: unknown) {
    this.emit("message", JSON.stringify(msg));
  }
}

const HELLO = {
  letter: "a",
  host: "blue.openfront.io",
  version: "bfd5563a11111111111111111111111111111111",
  numWorkers: 4,
  instanceId: "abcd1234",
};

function emptyRoster() {
  return {
    type: "roster",
    serverTime: Date.now(),
    games: { ffa: [], team: [], special: [], hosted: [] },
  };
}

describe("LobbyCoordinatorClient", () => {
  let sockets: FakeSocket[];
  let handlers: {
    [K in keyof CoordinatorHandlers]: Mock<CoordinatorHandlers[K]>;
  };
  let client: LobbyCoordinatorClient;
  let connectCalls: { url: string; headers: Record<string, string> }[];

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    connectCalls = [];
    handlers = {
      onRoster: vi.fn<CoordinatorHandlers["onRoster"]>(),
      onCreateGame: vi.fn<CoordinatorHandlers["onCreateGame"]>(),
      onUpdateLobby: vi.fn<CoordinatorHandlers["onUpdateLobby"]>(),
    };
    client = new LobbyCoordinatorClient({
      url: "wss://api.openfront.io/cluster/lobbies?site=openfront.io",
      apiKey: "secret",
      hello: HELLO,
      handlers,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      connect: (url, headers) => {
        connectCalls.push({ url, headers });
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
  });

  afterEach(() => {
    client.stop();
    vi.useRealTimers();
  });

  function current(): FakeSocket {
    return sockets[sockets.length - 1];
  }

  function connectAndOpen(): FakeSocket {
    client.start();
    const s = current();
    s.emit("open");
    return s;
  }

  it("connects with the game-server key and says hello first", () => {
    const s = connectAndOpen();
    expect(connectCalls[0].headers).toEqual({ "x-api-key": "secret" });
    expect(s.messages()[0]).toEqual({ type: "hello", ...HELLO });
  });

  it("sends the first report with the hello, then coalesces to one a second", () => {
    const s = connectAndOpen();
    expect(s.messages()[1]).toEqual({
      type: "report",
      lobbies: [],
      liveGames: 0,
    });
    // Three worker changes inside one second: one report, the latest.
    client.report([{ gameID: "A" } as any], 1);
    client.report([{ gameID: "B" } as any], 2);
    client.report([{ gameID: "C" } as any], 3);
    expect(s.messages()).toHaveLength(2);
    s.receive(emptyRoster());
    vi.advanceTimersByTime(1000);
    const reports = s.messages().filter((m) => m.type === "report");
    expect(reports).toHaveLength(2);
    expect(reports[1]).toEqual({
      type: "report",
      lobbies: [{ gameID: "C" }],
      liveGames: 3,
    });
  });

  it("heartbeats an unchanged report every 5s", () => {
    const s = connectAndOpen();
    s.receive(emptyRoster());
    const before = s.messages().filter((m) => m.type === "report").length;
    vi.advanceTimersByTime(REPORT_HEARTBEAT_MS - 1000);
    s.receive(emptyRoster());
    vi.advanceTimersByTime(1000);
    const after = s.messages().filter((m) => m.type === "report").length;
    expect(after).toBe(before + 1);
  });

  // The mode switch is "has a roster arrived recently", never "is the socket
  // open": an open socket can be dead.
  it("is coordinated only while rosters keep arriving", () => {
    const s = connectAndOpen();
    expect(client.isCoordinated()).toBe(false);
    s.receive(emptyRoster());
    expect(client.isCoordinated()).toBe(true);
    vi.advanceTimersByTime(COORDINATOR_STALE_MS - 1);
    expect(client.isCoordinated()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(client.isCoordinated()).toBe(false);
  });

  it("parses rosters and drops malformed lobbies one at a time", () => {
    const s = connectAndOpen();
    s.receive({
      type: "roster",
      serverTime: 5,
      games: {
        ffa: [
          { gameID: "GOOD1", numClients: 2, publicGameType: "ffa" },
          { gameID: 42, publicGameType: "ffa" },
        ],
        hosted: [],
      },
      delistGameIDs: ["LOSER1"],
    });
    expect(handlers.onRoster).toHaveBeenCalledTimes(1);
    const roster = handlers.onRoster.mock.calls[0][0];
    expect(roster.serverTime).toBe(5);
    expect(roster.games.ffa.map((l: any) => l.gameID)).toEqual(["GOOD1"]);
    expect(roster.games.team).toEqual([]);
    expect(roster.delistGameIDs).toEqual(["LOSER1"]);
  });

  it("forwards createGame and updateLobby, ignores junk", () => {
    const s = connectAndOpen();
    s.receive({ type: "createGame", publicGameType: "team", recentMaps: [] });
    s.receive({ type: "updateLobby", gameID: "G1", startsAt: 123 });
    s.receive({ type: "createGame", publicGameType: "hosted", recentMaps: [] });
    s.emit("message", "not json");
    expect(handlers.onCreateGame).toHaveBeenCalledTimes(1);
    expect(handlers.onCreateGame.mock.calls[0][0].publicGameType).toBe("team");
    expect(handlers.onUpdateLobby).toHaveBeenCalledWith({
      type: "updateLobby",
      gameID: "G1",
      startsAt: 123,
    });
  });

  it("reconnects with doubling backoff, capped, and resets after a good connection", () => {
    client.start();
    current().emit("close", 1006, Buffer.from(""));
    vi.advanceTimersByTime(RECONNECT_MIN_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    current().emit("close", 1006, Buffer.from(""));
    vi.advanceTimersByTime(2 * RECONNECT_MIN_MS);
    expect(sockets).toHaveLength(3);
    // Keep failing until the cap.
    for (let i = 0; i < 10; i++) {
      current().emit("close", 1006, Buffer.from(""));
      vi.advanceTimersByTime(RECONNECT_MAX_MS);
    }
    const n = sockets.length;
    current().emit("close", 1006, Buffer.from(""));
    vi.advanceTimersByTime(RECONNECT_MAX_MS - 1);
    expect(sockets).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(n + 1);
    // A successful open resets the backoff to 1s.
    current().emit("open");
    current().emit("close", 1006, Buffer.from(""));
    vi.advanceTimersByTime(RECONNECT_MIN_MS);
    expect(sockets).toHaveLength(n + 2);
  });

  // The site has sharedLobbies off (403 before any socket, or Disabled on a
  // live one): a deliberate refusal, retried slowly rather than hammered.
  it("retries slowly after a 403 or a Disabled close", () => {
    client.start();
    current().emit("unexpected-response", {}, { statusCode: 403 });
    vi.advanceTimersByTime(RECONNECT_SLOW_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    current().emit("open");
    current().emit("close", CoordinatorCloseCode.Disabled, Buffer.from(""));
    vi.advanceTimersByTime(RECONNECT_SLOW_MS - 1);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it("tears down a socket that has delivered no roster for 15s", () => {
    const s = connectAndOpen();
    s.receive(emptyRoster());
    vi.advanceTimersByTime(SOCKET_SILENCE_MS + 1000);
    expect(s.terminated).toBe(true);
    vi.advanceTimersByTime(RECONNECT_MIN_MS);
    expect(sockets).toHaveLength(2);
    expect(current()).not.toBe(s);
  });

  it("ignores events from a socket it has already replaced", () => {
    client.start();
    const old = current();
    old.emit("close", 1006, Buffer.from(""));
    vi.advanceTimersByTime(RECONNECT_MIN_MS);
    const fresh = current();
    fresh.emit("open");
    fresh.receive(emptyRoster());
    // A late close from the old socket must not schedule another reconnect
    // or forget the live one. Short of the silence guard, which would
    // legitimately reconnect a socket that stops delivering rosters.
    old.emit("close", 1006, Buffer.from(""));
    vi.advanceTimersByTime(SOCKET_SILENCE_MS - 1000);
    expect(sockets).toHaveLength(2);
    expect(current()).toBe(fresh);
  });

  it("stop closes the socket and stops reconnecting", () => {
    const s = connectAndOpen();
    client.stop();
    expect(s.closed?.code).toBe(CloseCode.Normal);
    s.emit("close", CloseCode.Normal, Buffer.from(""));
    vi.advanceTimersByTime(RECONNECT_MAX_MS);
    expect(sockets).toHaveLength(1);
  });
});

describe("coordinatorUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is null without LOBBY_COORDINATOR=api or without a site", () => {
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("LOBBY_COORDINATOR", "");
    expect(coordinatorUrl("openfront.io")).toBeNull();
    vi.stubEnv("LOBBY_COORDINATOR", "api");
    expect(coordinatorUrl(undefined)).toBeNull();
  });

  it("points at the API's lobbies endpoint over wss for the site", () => {
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("LOBBY_COORDINATOR", "api");
    expect(coordinatorUrl("openfront.io")).toBe(
      "wss://api.openfront.io/cluster/lobbies?site=openfront.io",
    );
    vi.stubEnv("DOMAIN", "localhost");
    expect(coordinatorUrl("localhost")).toBe(
      "ws://localhost:8787/cluster/lobbies?site=localhost",
    );
  });
});
