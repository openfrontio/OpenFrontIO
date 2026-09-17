import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../src/client/ClientEnv";
import { PublicLobbySocket } from "../src/client/LobbySocket";
import type { ServerListStatus } from "../src/client/ServerList";
import {
  PublicGameInfo,
  PublicGames,
  PublicGameType,
} from "../src/core/Schemas";
import { lobbyFrame } from "./util/Wire";

const mocks = vi.hoisted(() => ({
  ensureServerList: vi.fn(async (): Promise<string> => "api"),
  // The post-failure question (ServerList.reloadWouldRescue): would a
  // reload actually land this tab somewhere better? Asked only once
  // reconnecting has given up, never at page load.
  reloadWouldRescue: vi.fn((_status: ServerListStatus): boolean => false),
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
  return {
    ...actual,
    ensureServerList: mocks.ensureServerList,
    reloadWouldRescue: mocks.reloadWouldRescue,
  };
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
    mocks.reloadWouldRescue.mockReset();
    mocks.reloadWouldRescue.mockReturnValue(false);
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
  //
  // This page names a server of its own (serverHost above), so the list
  // never answers "outdated" here — the OPE-430 rule. What decides is
  // ServerList.reloadWouldRescue, handed the fresh status: the socket has
  // proven that server is gone, and behind an apex a reload lands on a live
  // deployment.
  it("asks the list again once reconnecting has given up, and prompts when a reload would rescue it", async () => {
    const onUpdateAvailable = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), {
      onUpdateAvailable,
      maxWsAttempts: 1,
    });
    await socket.start();
    expect(onUpdateAvailable).not.toHaveBeenCalled();

    mocks.ensureServerList.mockResolvedValue("fallback");
    mocks.reloadWouldRescue.mockReturnValue(true);
    (socket as any).handleClose();
    await Promise.resolve();
    await Promise.resolve();
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    // Asked about the status the list has just given, not about a stale one.
    expect(mocks.reloadWouldRescue).toHaveBeenCalledWith("fallback");

    // Every further failure re-asks at most a prompt already given.
    (socket as any).handleClose();
    (socket as any).handleConnectError(new Error("refused"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    socket.stop();
  });

  // A client whose wire format the server has moved past: every socket opens
  // and every frame fails to decode. Resetting the attempt count on open made
  // that loop forever, so the cap -- and with it the outdated prompt and the
  // give-up signal -- was unreachable in exactly the case it exists for.
  it("reaches the cap when sockets open but no frame ever decodes", async () => {
    const onGaveUp = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), {
      onGaveUp,
      maxWsAttempts: 2,
    });
    await socket.start();

    (socket as any).handleOpen();
    (socket as any).handleClose();
    expect(onGaveUp).not.toHaveBeenCalled();

    (socket as any).connectWebSocket();
    (socket as any).handleOpen();
    (socket as any).handleClose();
    expect(onGaveUp).toHaveBeenCalledTimes(1);
    socket.stop();
  });

  it("starts the count over once a frame decodes", async () => {
    const onGaveUp = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), {
      onGaveUp,
      maxWsAttempts: 2,
    });
    await socket.start();
    (socket as any).handleClose();

    (socket as any).connectWebSocket();
    (socket as any).handleOpen();
    const frame = fullMessage(1000, {});
    (socket as any).handleMessage({
      data: frame.buffer.slice(
        frame.byteOffset,
        frame.byteOffset + frame.byteLength,
      ),
    } as MessageEvent);
    (socket as any).handleClose();

    expect(onGaveUp).not.toHaveBeenCalled();
    socket.stop();
  });

  // The control for the rescue above: the list still has a server for this
  // build, so a socket failure is just a socket failure — a blip, not a
  // deployment that went away. The status is handed over all the same; the
  // rule that reads it lives in ServerList (reloadWouldRescue), where every
  // topology is exercised against real lists.
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
    expect(mocks.reloadWouldRescue).toHaveBeenCalledWith("api");
    socket.stop();
  });

  // The line between the two questions (OPE-430): at page load a
  // server-rendered page must not be prompted even when a reload from a
  // dead server would have rescued it — its own server is serving it right
  // now, so the reload comes back identical and prompts again. Only a
  // socket that has given up turns the same facts into the rescue above,
  // which is why the question is not even asked here.
  it("does not prompt at page load on a server-rendered page", async () => {
    mocks.ensureServerList.mockResolvedValue("fallback");
    mocks.reloadWouldRescue.mockReturnValue(true);
    const onUpdateAvailable = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), { onUpdateAvailable });

    await socket.start();
    socket.stop();

    expect(onUpdateAvailable).not.toHaveBeenCalled();
    expect(mocks.reloadWouldRescue).not.toHaveBeenCalled();
  });

  it("does not prompt after the socket was stopped", async () => {
    const onUpdateAvailable = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), {
      onUpdateAvailable,
      maxWsAttempts: 1,
    });
    await socket.start();
    mocks.ensureServerList.mockResolvedValue("fallback");
    mocks.reloadWouldRescue.mockReturnValue(true);
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
        maxWsAttempts: 2,
        reconnectDelay: 1000,
      });

      await socket.start();
      expect(urls).toHaveLength(0);
      // One attempt of two is spent, so nothing is reported to the player
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

  it("gives up after maxWsAttempts when no server ever appears", async () => {
    // Each discovery attempt has to COUNT. The socket path clears
    // wsAttemptCounted inside connectWebSocket, which discovery never
    // reaches, so without clearing it per attempt the counter freezes at one
    // and this retries every reconnectDelay forever, silently.
    vi.useFakeTimers();
    try {
      const socket = new PublicLobbySocket(vi.fn(), {
        maxWsAttempts: 2,
        reconnectDelay: 1000,
      });

      await socket.start();
      expect(mocks.showInGameAlert).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);

      expect(mocks.showInGameAlert).toHaveBeenCalledTimes(1);
      expect(mocks.showInGameAlert.mock.calls[0][0]).toContain("connection");

      // And it stops: no third attempt, no second alert.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.showInGameAlert).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// OPE-430, end to end through the real server list: the one flow that
// prompts, on the kind of page that must never be prompted.
//
// Live on main.openfront.dev, where the page is still rendered by a game
// server: a deploy failed to register the new build in the API's registry,
// so the list carried no server on the page's build and a `latest` that was
// a different commit. This socket raised "a new version of OpenFront is
// available", the reload re-fetched the same page from the same server, and
// it prompted again — forever.
describe("PublicLobbySocket.start on a page its own game server rendered", () => {
  const OLD = "5ccc50a722222222222222222222222222222222";
  // No server on the old build, latest is a different commit: the list that
  // used to answer "outdated".
  const NOTHING_ON_MY_BUILD = {
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

  class FakeWebSocket {
    static OPEN = 1;
    readyState = 0;
    binaryType = "";
    constructor(public url: string) {}
    addEventListener() {}
    close() {}
  }

  let serverList: typeof import("../src/client/ServerList");

  function bootstrap(extra: Record<string, unknown>) {
    ClientEnv.reset();
    serverList.resetServerList();
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      turnstileSiteKey: "k",
      jwtAudience: "openfront.io",
      gitCommit: OLD,
      ...extra,
    };
  }

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.showInGameAlert.mockClear();
    // The status is what is under test here, so the real implementation
    // runs — against a stubbed fetch, not the network.
    serverList = await vi.importActual<
      typeof import("../src/client/ServerList")
    >("../src/client/ServerList");
    mocks.ensureServerList.mockReset();
    mocks.ensureServerList.mockImplementation(serverList.ensureServerList);
    mocks.reloadWouldRescue.mockReset();
    mocks.reloadWouldRescue.mockImplementation(serverList.reloadWouldRescue);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify(NOTHING_ON_MY_BUILD), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
  });

  afterEach(() => {
    serverList.resetServerList();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    ClientEnv.reset();
    delete (window as any).BOOTSTRAP_CONFIG;
  });

  it("does not prompt: a reload would re-serve the same page from the same server", async () => {
    bootstrap({
      // Prod's shape: a sibling in the map is what makes the site host an
      // apex a reload can land elsewhere through (reloadCanLandElsewhere).
      cluster: {
        a: { host: "blue.openfront.io", numWorkers: 2 },
        b: { host: "green.openfront.io", numWorkers: 2 },
      },
      instanceLetter: "a",
      serverHost: "blue.openfront.io",
    });
    const onUpdateAvailable = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), { onUpdateAvailable });

    await socket.start();

    expect(onUpdateAvailable).not.toHaveBeenCalled();
    // And the lobby list still connects, on the page's own server.
    expect((socket as any).ws.url).toMatch(
      /^wss:\/\/blue\.openfront\.io\/w\d+\/lobbies$/,
    );
    socket.stop();
  });

  // The rescue, end to end on the same page and the same list: once the
  // socket has given up, that server has proven it cannot answer, and the
  // reload goes through the page host — which the load balancer answers
  // from a live deployment. So the newer version IS news now.
  it("prompts once its socket has given up, though the same list said fallback", async () => {
    // Prod's shape: the page is served behind the apex, so reloadForUpdate
    // re-enters through openfront.io and the load balancer answers from a
    // live deployment — the reload cannot come back to this dead host.
    bootstrap({
      // Prod's shape: a sibling in the map is what makes the site host an
      // apex a reload can land elsewhere through (reloadCanLandElsewhere).
      cluster: {
        a: { host: "blue.openfront.io", numWorkers: 2 },
        b: { host: "green.openfront.io", numWorkers: 2 },
      },
      instanceLetter: "a",
      serverHost: "blue.openfront.io",
      siteHost: "openfront.io",
    });
    const onUpdateAvailable = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), {
      onUpdateAvailable,
      maxWsAttempts: 1,
    });

    await socket.start();
    expect(onUpdateAvailable).not.toHaveBeenCalled();

    (socket as any).handleClose();
    await Promise.resolve();
    await Promise.resolve();
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    socket.stop();
  });

  // Registration lag on an apex page, end to end: the registry names a
  // stale version for this page's own host while `latest` is already this
  // page's build. Nothing in the list serves this build, yet the server
  // that rendered the page is alive and correct — so the page keeps it, the
  // lobby list connects there, and nothing prompts.
  it("never prompts when the registry lags behind a server that is already latest", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            latest: OWN,
            servers: {
              a: {
                host: "blue.openfront.io",
                numWorkers: 2,
                version: OLD,
                state: "open" as const,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    bootstrap({
      gitCommit: OWN,
      cluster: {
        a: { host: "blue.openfront.io", numWorkers: 2 },
        b: { host: "green.openfront.io", numWorkers: 2 },
      },
      instanceLetter: "a",
      serverHost: "blue.openfront.io",
      siteHost: "openfront.io",
    });
    const onUpdateAvailable = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), {
      onUpdateAvailable,
      maxWsAttempts: 1,
    });

    await socket.start();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
    expect((socket as any).ws.url).toMatch(
      /^wss:\/\/blue\.openfront\.io\/w\d+\/lobbies$/,
    );

    // And not after the socket gives up either: there is no newer build.
    (socket as any).handleClose();
    await Promise.resolve();
    await Promise.resolve();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
    socket.stop();
  });

  // A standalone deployment (dev's main.openfront.dev today, previews,
  // beta) has nowhere else for a reload to go: its site's list names only
  // its own server, and Traefik routes its page host and its game host to
  // the same container. So even a socket that has given up raises nothing —
  // a prompt there would reload straight back into this page and fire again.
  it("never prompts a standalone page, even once its socket has given up", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            latest: OWN,
            servers: {
              a: {
                host: "main.server.openfront.dev",
                numWorkers: 2,
                version: OWN,
                state: "open" as const,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    bootstrap({
      cluster: { a: { host: "main.server.openfront.dev", numWorkers: 2 } },
      instanceLetter: "a",
      serverHost: "main.server.openfront.dev",
      siteHost: "main.openfront.dev",
    });
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

  it("still prompts a Worker-served page on the very same list", async () => {
    // The control: nothing about the list changed, only whether the page
    // names a server. A page that names none reloads into `latest`, so
    // "outdated" is true news there.
    bootstrap({});
    const onUpdateAvailable = vi.fn();
    const socket = new PublicLobbySocket(vi.fn(), {
      onUpdateAvailable,
      maxWsAttempts: 1,
    });

    await socket.start();
    socket.stop();

    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
  });
});
