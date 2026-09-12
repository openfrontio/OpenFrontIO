import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../src/client/ClientEnv";
import { PublicLobbySocket } from "../src/client/LobbySocket";
import {
  PublicGameInfo,
  PublicGames,
  PublicGameType,
} from "../src/core/Schemas";
import { lobbyFrame } from "./util/Wire";

const mocks = vi.hoisted(() => ({
  ensureServerList: vi.fn(async (): Promise<string> => "api"),
  showInGameAlert: vi.fn(async (_message: string) => {}),
}));

// start() asks the server list which server to use; the answer is what is
// under test here, so nothing reaches the network. The alert is the
// connection-error surface the no-server case is expected to reach.
vi.mock("../src/client/InGameModal", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, showInGameAlert: mocks.showInGameAlert };
});
vi.mock("../src/client/ServerList", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ensureServerList: mocks.ensureServerList };
});

function lobby(
  gameID: string,
  numClients: number,
  publicGameType: PublicGameType = "ffa",
): PublicGameInfo {
  return { gameID, numClients, publicGameType };
}

function fullMessage(
  serverTime: number,
  games: Partial<Record<PublicGameType, PublicGameInfo[]>>,
) {
  return lobbyFrame({
    type: "full",
    serverTime,
    games: { ffa: [], team: [], special: [], ...games },
  });
}

function countsMessage(serverTime: number, counts: Record<string, number>) {
  return lobbyFrame({ type: "counts", serverTime, counts });
}

function drainedMessage(serverTime: number, active: boolean | undefined) {
  return lobbyFrame({
    type: "full",
    serverTime,
    games: { ffa: [], team: [], special: [] },
    active,
  });
}

function makeSocket(options?: { onUpdateAvailable?: () => void }) {
  const callback = vi.fn<(g: PublicGames) => void>();
  const socket = new PublicLobbySocket(callback, options);
  const dispatch = (frame: Uint8Array) => {
    // The real socket is in arraybuffer mode, so handleMessage sees an
    // ArrayBuffer, not a Uint8Array.
    const data = frame.buffer.slice(
      frame.byteOffset,
      frame.byteOffset + frame.byteLength,
    );
    (socket as any).handleMessage({ data } as MessageEvent);
  };
  return { socket, callback, dispatch };
}

describe("PublicLobbySocket.handleMessage", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("delivers a full snapshot to the callback", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(
      fullMessage(1000, {
        ffa: [lobby("g1", 3)],
        team: [lobby("g2", 5, "team")],
      }),
    );

    expect(callback).toHaveBeenCalledTimes(1);
    const arg = callback.mock.calls[0][0];
    expect(arg.serverTime).toBe(1000);
    expect(arg.games.ffa).toEqual([lobby("g1", 3)]);
    expect(arg.games.team).toEqual([lobby("g2", 5, "team")]);
  });

  it("patches numClients onto the last full snapshot when counts arrives", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(fullMessage(1000, { ffa: [lobby("g1", 3), lobby("g2", 4)] }));
    callback.mockClear();

    dispatch(countsMessage(1500, { g1: 7, g2: 4 }));

    expect(callback).toHaveBeenCalledTimes(1);
    const arg = callback.mock.calls[0][0];
    expect(arg.serverTime).toBe(1500);
    expect(arg.games.ffa).toEqual([lobby("g1", 7), lobby("g2", 4)]);
    // Static fields (gameConfig, startsAt, publicGameType) survive the patch.
    expect(arg.games.ffa?.[0].publicGameType).toBe("ffa");
  });

  it("ignores counts arriving before any full snapshot", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(countsMessage(1000, { g1: 5 }));
    expect(callback).not.toHaveBeenCalled();
  });

  it("leaves lobbies whose gameID is absent from counts unchanged", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(fullMessage(1000, { ffa: [lobby("g1", 3), lobby("g2", 4)] }));
    callback.mockClear();

    dispatch(countsMessage(1500, { g1: 9 }));

    const arg = callback.mock.calls[0][0];
    expect(arg.games.ffa).toEqual([lobby("g1", 9), lobby("g2", 4)]);
  });

  it("applies consecutive counts deltas on top of the merged state", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(fullMessage(1000, { ffa: [lobby("g1", 1)] }));
    dispatch(countsMessage(1500, { g1: 2 }));
    dispatch(countsMessage(2000, { g1: 3 }));

    expect(callback).toHaveBeenCalledTimes(3);
    expect(callback.mock.calls[2][0].games.ffa).toEqual([lobby("g1", 3)]);
    expect(callback.mock.calls[2][0].serverTime).toBe(2000);
  });

  it("replaces lobby set when a fresh full snapshot arrives", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(fullMessage(1000, { ffa: [lobby("g1", 3)] }));
    dispatch(fullMessage(2000, { ffa: [lobby("g2", 5)] }));

    const arg = callback.mock.calls[1][0];
    expect(arg.games.ffa).toEqual([lobby("g2", 5)]);
    expect(arg.serverTime).toBe(2000);
  });

  it("does not call the callback on a corrupt frame", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(new Uint8Array([0xff, 0xff, 0xff]));
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not call the callback on a truncated frame", () => {
    const { callback, dispatch } = makeSocket();
    const frame = countsMessage(1, { g1: 2 });
    dispatch(frame.subarray(0, frame.length - 1));
    expect(callback).not.toHaveBeenCalled();
  });

  it("patches counts onto hosted lobbies too", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(fullMessage(1000, { hosted: [lobby("h1", 2, "hosted")] }));
    callback.mockClear();

    dispatch(countsMessage(1500, { h1: 6 }));

    const arg = callback.mock.calls[0][0];
    expect(arg.games.hosted).toEqual([lobby("h1", 6, "hosted")]);
  });

  it("does not mutate the previously-delivered snapshot when applying counts", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(fullMessage(1000, { ffa: [lobby("g1", 3)] }));
    const prevSnapshot = callback.mock.calls[0][0];
    const prevFfa = prevSnapshot.games.ffa;

    dispatch(countsMessage(1500, { g1: 99 }));

    expect(prevSnapshot.serverTime).toBe(1000);
    expect(prevFfa).toEqual([lobby("g1", 3)]);
  });
});

describe("PublicLobbySocket deployment drain", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("fires onUpdateAvailable once when the feed reports active:false", () => {
    const onUpdateAvailable = vi.fn();
    const { dispatch } = makeSocket({ onUpdateAvailable });

    dispatch(drainedMessage(1000, false));
    dispatch(drainedMessage(1001, false));

    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  it("does not fire while the deployment is active or the flag is absent", () => {
    const onUpdateAvailable = vi.fn();
    const { dispatch } = makeSocket({ onUpdateAvailable });

    dispatch(drainedMessage(1000, true));
    dispatch(drainedMessage(1001, undefined));

    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });
});

// Multi-server v2 (docs/MultiServer.md, "Server list v2"): when no server
// takes new games from this build any more and the list names a newer
// version, the player finds out here — the lobby list is the first thing
// every homepage starts. It raises the same "update available" prompt a
// newer commit in the feed does, and the page is never navigated by the
// list itself.
describe("PublicLobbySocket.start when this build is outdated", () => {
  class FakeWebSocket {
    static OPEN = 1;
    readyState = 0;
    binaryType = "";
    constructor(public url: string) {}
    addEventListener() {}
    close() {}
  }

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.ensureServerList.mockReset();
    mocks.ensureServerList.mockResolvedValue("api");
    vi.stubGlobal("WebSocket", FakeWebSocket);
    ClientEnv.reset();
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 2,
      turnstileSiteKey: "k",
      jwtAudience: "openfront.io",
      instanceId: "test",
      gitCommit: "5ccc50a722222222222222222222222222222222",
      serverHost: "blue.openfront.io",
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    ClientEnv.reset();
    delete (window as any).BOOTSTRAP_CONFIG;
  });

  it("prompts once when the list says this build is outdated", async () => {
    mocks.ensureServerList.mockResolvedValue("outdated");
    const onUpdateAvailable = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), { onUpdateAvailable });

    await socket.start();
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);

    // Reconnecting (the player left a lobby, the list refreshed) must not
    // stack a second prompt on the first.
    socket.stop();
    await socket.start();
    socket.stop();
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  it("still connects, so the desktop shell and a fallback page keep their lobby list", async () => {
    mocks.ensureServerList.mockResolvedValue("outdated");
    const socket = new PublicLobbySocket(vi.fn(), {});
    await socket.start();
    expect((socket as any).ws).not.toBeNull();
    socket.stop();
  });

  // The tab that was already here when the rollover happened: its server
  // drained, then fenced, and the socket just fails. No feed arrives to
  // carry a commit or a drain flag, so the list is the only thing left that
  // can tell the player to reload.
  it("asks the list again once reconnecting has given up, and prompts if this build is outdated", async () => {
    const onUpdateAvailable = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), {
      onUpdateAvailable,
      maxWsAttempts: 1,
    });
    await socket.start();
    expect(onUpdateAvailable).not.toHaveBeenCalled();

    mocks.ensureServerList.mockResolvedValue("outdated");
    (socket as any).handleClose();
    await Promise.resolve();
    await Promise.resolve();
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);

    // Every further failure re-asks at most a prompt already given.
    (socket as any).handleClose();
    (socket as any).handleConnectError(new Error("refused"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    socket.stop();
  });

  it("does not prompt when the socket fails but a server is still there", async () => {
    const onUpdateAvailable = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), {
      onUpdateAvailable,
      maxWsAttempts: 1,
    });
    await socket.start();
    (socket as any).handleClose();
    await Promise.resolve();
    await Promise.resolve();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
    socket.stop();
  });

  it("does not prompt after the socket was stopped", async () => {
    const onUpdateAvailable = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), {
      onUpdateAvailable,
      maxWsAttempts: 1,
    });
    await socket.start();
    mocks.ensureServerList.mockResolvedValue("outdated");
    (socket as any).promptIfOutdated();
    socket.stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it("does not prompt when a server was picked, or when nothing newer exists", async () => {
    for (const status of ["api", "fallback", "no-server"]) {
      mocks.ensureServerList.mockResolvedValue(status);
      const onUpdateAvailable = vi.fn();
      const socket = new PublicLobbySocket(vi.fn(), { onUpdateAvailable });
      await socket.start();
      socket.stop();
      expect(onUpdateAvailable).not.toHaveBeenCalled();
    }
  });
});

const OWN = "bfd5563a11111111111111111111111111111111";

const LIST = {
  latest: OWN,
  servers: {
    d: {
      host: "falk2-b.openfront.io",
      numWorkers: 8,
      version: OWN,
      state: "open" as const,
    },
  },
};

// A static page knows no server of its own, so when the API's list is
// unreachable there is no worker count anywhere and ClientEnv throws
// NoServerError. The lobby list is the first thing every homepage starts, so
// that throw must arrive as the connection error the player already
// understands -- not as a rejected promise from an un-awaited start().
describe("PublicLobbySocket.start with no server known", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.showInGameAlert.mockClear();
    mocks.ensureServerList.mockReset();
    mocks.ensureServerList.mockResolvedValue("fallback");
    ClientEnv.reset();
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      turnstileSiteKey: "k",
      jwtAudience: "openfront.io",
      gitCommit: OWN,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ClientEnv.reset();
    delete (window as any).BOOTSTRAP_CONFIG;
  });

  it("reports a connection error instead of rejecting", async () => {
    const socket = new PublicLobbySocket(vi.fn(), { maxWsAttempts: 1 });

    await expect(socket.start()).resolves.toBeUndefined();

    expect(mocks.showInGameAlert).toHaveBeenCalledTimes(1);
    expect(mocks.showInGameAlert.mock.calls[0][0]).toContain("connection");
  });

  it("re-runs discovery on the retry and connects once a server is known", async () => {
    // The retry must not go straight back to connectWebSocket: there was no
    // worker path to build a URL with, so every remaining attempt would be
    // spent re-dialling the same empty one. The list arriving between
    // attempts is exactly the case this has to recover from.
    const urls: string[] = [];
    class FakeWebSocket {
      binaryType = "";
      constructor(url: string) {
        urls.push(url);
      }
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.useFakeTimers();
    try {
      const socket = new PublicLobbySocket(vi.fn(), {
        maxWsAttempts: 3,
        reconnectDelay: 1000,
      });

      await socket.start();
      expect(urls).toHaveLength(0);
      // One attempt of three is spent, so nothing is reported to the player
      // yet -- a retry is pending.
      expect(mocks.showInGameAlert).not.toHaveBeenCalled();

      ClientEnv.applyServerList(LIST, "d");
      await vi.advanceTimersByTimeAsync(1000);

      expect(urls).toHaveLength(1);
      expect(urls[0]).toMatch(
        /^wss:\/\/falk2-b\.openfront\.io\/w\d+\/lobbies$/,
      );
      expect(mocks.showInGameAlert).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
