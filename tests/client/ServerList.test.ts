import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import {
  backendReachable,
  ensureServerList,
  resetServerList,
  serverListSite,
  serverListUrl,
  startServerListPolling,
  stopServerListPolling,
} from "../../src/client/ServerList";

// Priority 1 of the multi-server v2 handoff: the client fetches the server
// list from the API at page load and keeps it warm with a heartbeat, filters
// it by its own version, and falls back to BOOTSTRAP_CONFIG whenever the
// list is missing or unreachable so that production behaves exactly as today
// until the API serves it. A click never waits on a fetch once a list is
// known, and a failed refresh never throws the last good list away.

const REFRESH_MS = 30_000;
const RETRY_MS = 10_000;

const OWN = "bfd5563a11111111111111111111111111111111";
const OLD = "5ccc50a722222222222222222222222222222222";

const API_LIST = {
  latest: OWN,
  servers: {
    c: {
      host: "falk2-a.openfront.io",
      numWorkers: 16,
      version: OLD,
      state: "draining",
    },
    d: {
      host: "falk2-b.openfront.io",
      numWorkers: 16,
      version: OWN,
      state: "open",
    },
  },
};

function setBootstrap(overrides: Record<string, unknown> = {}) {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    cluster: {
      a: { host: "blue.openfront.io", color: "blue", numWorkers: 2 },
      b: { host: "green.openfront.io", color: "green", numWorkers: 2 },
    },
    instanceLetter: "a",
    turnstileSiteKey: "x",
    jwtAudience: "openfront.io",
    instanceId: "test",
    gitCommit: OWN,
    serverHost: "blue.openfront.io",
    siteHost: "openfront.io",
    ...overrides,
  };
  ClientEnv.reset();
  resetServerList();
}

function stubLocation(host: string, pathname = "/", search = "") {
  const loc: any = {
    protocol: "https:",
    host,
    hostname: host,
    pathname,
    search,
    href: `https://${host}${pathname}${search}`,
  };
  Object.defineProperty(window, "location", {
    value: loc,
    writable: true,
    configurable: true,
  });
  return loc;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse(API_LIST));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stubLocation("openfront.io");
  delete (window as any).openfrontDesktop;
  setBootstrap();
});

afterEach(() => {
  stopServerListPolling();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as any).BOOTSTRAP_CONFIG;
  delete (window as any).openfrontDesktop;
  ClientEnv.reset();
  resetServerList();
});

describe("which list a page asks for", () => {
  it("a web page asks for the site it was loaded from", () => {
    // siteHost (the apex) wins over a deployment host the page may have
    // been fetched from directly; without it, the document host is the site.
    expect(serverListSite()).toBe("openfront.io");
    setBootstrap({ siteHost: undefined });
    stubLocation("my-branch.openfront.dev");
    expect(serverListSite()).toBe("my-branch.openfront.dev");
  });

  it("the desktop shell asks for its injected serverHost, whatever the document host", () => {
    (window as any).openfrontDesktop = {};
    setBootstrap({ serverHost: "nightly.openfront.dev", siteHost: undefined });
    stubLocation("openfront");
    expect(serverListSite()).toBe("nightly.openfront.dev");
  });

  it("builds the API url from the audience and the site", () => {
    expect(serverListUrl("openfront.io")).toBe(
      "https://api.openfront.io/cluster.json?site=openfront.io",
    );
  });
});

describe("ensureServerList", () => {
  it("does not fetch at module load or on ClientEnv reads", () => {
    ClientEnv.serverWsBase();
    ClientEnv.numWorkers();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads the list, picks an open server on the client's version, and routes to it", async () => {
    expect(await ensureServerList()).toBe("api");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.openfront.io/cluster.json?site=openfront.io",
    );
    expect(ClientEnv.serverWsBase()).toBe("wss://falk2-b.openfront.io");
    expect(ClientEnv.serverHttpBase()).toBe("https://falk2-b.openfront.io");
    expect(ClientEnv.numWorkers()).toBe(16);
    expect(ClientEnv.serverListLoaded()).toBe(true);
  });

  it("resolves existing games by letter from the list, whatever their state", async () => {
    await ensureServerList();
    expect(ClientEnv.resolveGame("cAbCd12345")).toEqual({
      kind: "cross",
      host: "falk2-a.openfront.io",
      numWorkers: 16,
    });
    expect(ClientEnv.gameWsBase("cAbCd12345")).toBe(
      "wss://falk2-a.openfront.io",
    );
    expect(ClientEnv.resolveGame("dAbCd12345")).toEqual({ kind: "own" });
    expect(ClientEnv.resolveGame("zAbCd12345")).toEqual({
      kind: "unknown-letter",
    });
  });

  it("answers from the cached list without waiting, and refreshes behind it", async () => {
    vi.useFakeTimers();
    expect(await ensureServerList()).toBe("api");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A second click reuses what is already known.
    expect(await ensureServerList()).toBe("api");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past the refresh interval the list is stale, but a click STILL must
    // not wait on the network: a fetch that never answers cannot stop this
    // call from resolving from the cached list. It only kicks off one
    // background refresh, however many times it is asked.
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    await vi.advanceTimersByTimeAsync(REFRESH_MS + 1);
    expect(await ensureServerList()).toBe("api");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await ensureServerList()).toBe("api");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ClientEnv.serverWsBase()).toBe("wss://falk2-b.openfront.io");
  });

  it("keeps the last good list when a refresh fails", async () => {
    // The API caches for seconds and a blip is common; losing the list would
    // flip a working page into BOOTSTRAP_CONFIG for no reason.
    vi.useFakeTimers();
    expect(await ensureServerList()).toBe("api");
    fetchMock.mockRejectedValue(new TypeError("network down"));
    await vi.advanceTimersByTimeAsync(REFRESH_MS + 1);
    expect(await ensureServerList()).toBe("api");
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ClientEnv.serverListLoaded()).toBe(true);
    expect(ClientEnv.serverWsBase()).toBe("wss://falk2-b.openfront.io");
    expect(await ensureServerList()).toBe("api");
    expect(ClientEnv.serverWsBase()).toBe("wss://falk2-b.openfront.io");
  });

  // The same rule as the no-list case, on the other branch: once the list is
  // stale it STAYS stale until an attempt succeeds, so a failing API would
  // otherwise get one background refresh per caller — and the matchmaking
  // poll is a caller every second. The list keeps serving throughout.
  it("does not re-refresh for every caller while a stale refresh keeps failing", async () => {
    vi.useFakeTimers();
    expect(await ensureServerList()).toBe("api");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Stale now, and the refresh behind the answer fails.
    fetchMock.mockRejectedValue(new TypeError("network down"));
    await vi.advanceTimersByTimeAsync(REFRESH_MS + 1);
    expect(await ensureServerList()).toBe("api");
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(400);
      expect(await ensureServerList()).toBe("api");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ClientEnv.serverWsBase()).toBe("wss://falk2-b.openfront.io");

    // Once the retry interval is up, the next ask may refresh again.
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(await ensureServerList()).toBe("api");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to BOOTSTRAP_CONFIG when the API is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    expect(await ensureServerList()).toBe("fallback");
    expect(ClientEnv.serverWsBase()).toBe("wss://blue.openfront.io");
    expect(ClientEnv.numWorkers()).toBe(2);
    expect(ClientEnv.resolveGame("bAbCd12345")).toEqual({
      kind: "cross",
      host: "green.openfront.io",
      numWorkers: 2,
    });
    expect(ClientEnv.serverListLoaded()).toBe(false);
  });

  it.each([
    ["a 404", () => jsonResponse({ error: "unknown site" }, 404)],
    ["a malformed body", () => jsonResponse({ servers: { d: { host: 1 } } })],
    ["an empty list", () => jsonResponse({ servers: {} })],
  ])("falls back to BOOTSTRAP_CONFIG on %s", async (_name, make) => {
    fetchMock.mockImplementation(async () => make());
    expect(await ensureServerList()).toBe("fallback");
    expect(ClientEnv.serverWsBase()).toBe("wss://blue.openfront.io");
  });

  // With the API 404ing (its rollout has not happened yet) every page is a
  // page with no list, and Matchmaking's checkGame asks once a second. A
  // fetch per ask is a self-inflicted DDoS; the heartbeat is the only thing
  // that should retry, on its own 10s cadence.
  it("does not re-fetch for every caller while it has no list", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: "unknown site" }, 404),
    );
    expect(await ensureServerList()).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(400);
      expect(await ensureServerList()).toBe("fallback");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Once the retry interval is up, the next ask may try again.
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(await ensureServerList()).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds the fetch so an unreachable API cannot hang a join", async () => {
    // A server that accepts the connection and never answers. The fetch
    // must carry a timeout signal of a few seconds, and an abort must land
    // on the fallback path rather than reject the caller.
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 20);
        return controller.signal;
      });
    fetchMock.mockImplementation(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    expect(await ensureServerList()).toBe("fallback");
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    const boundMs = timeoutSpy.mock.calls[0][0];
    expect(boundMs).toBeGreaterThan(0);
    expect(boundMs).toBeLessThanOrEqual(10_000);
    expect(ClientEnv.serverWsBase()).toBe("wss://blue.openfront.io");
  });

  it("keeps the picked server across refreshes while it stays open", async () => {
    const list = {
      latest: OWN,
      servers: {
        d: {
          host: "d.openfront.io",
          numWorkers: 1,
          version: OWN,
          state: "open",
        },
        e: {
          host: "e.openfront.io",
          numWorkers: 1,
          version: OWN,
          state: "open",
        },
      },
    };
    fetchMock.mockImplementation(async () => jsonResponse(list));
    vi.useFakeTimers();
    await ensureServerList();
    const first = ClientEnv.serverHttpBase();
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      await ensureServerList();
      expect(ClientEnv.serverHttpBase()).toBe(first);
    }
    vi.useRealTimers();
  });
});

describe("startServerListPolling", () => {
  it("fetches at page load and keeps a heartbeat, retrying sooner after a failure", async () => {
    vi.useFakeTimers();
    startServerListPolling();
    // The first attempt goes out immediately, so the list is already known
    // by the time a player clicks anything.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    // Starting twice is a no-op: one heartbeat, not two.
    startServerListPolling();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Next beat is REFRESH_MS after the attempt settled.
    await vi.advanceTimersByTimeAsync(REFRESH_MS - 10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValue(new TypeError("network down"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // That one failed, so the next beat comes at RETRY_MS instead.
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    stopServerListPolling();
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not poll on a replay shell host", async () => {
    // Replay shells talk to the archive, not to a live server list.
    stubLocation("replay.openfront.io");
    vi.useFakeTimers();
    startServerListPolling();
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("backend reachability", () => {
  it("reports whether the API answered at all, and announces every change", async () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    document.addEventListener("backend-reachability", listener);
    // A page with no list only attempts once per retry interval, so each
    // phase below has to wait the interval out to get a fresh attempt.
    vi.useFakeTimers();
    try {
      // Nothing has been tried yet.
      expect(backendReachable()).toBe(null);
      expect(seen).toEqual([]);

      // A 404 is an answer: the backend is up, this site just has no list.
      fetchMock.mockImplementation(async () =>
        jsonResponse({ error: "unknown site" }, 404),
      );
      expect(await ensureServerList()).toBe("fallback");
      expect(backendReachable()).toBe(true);
      expect(seen).toEqual([{ reachable: true }]);

      // Unchanged: no second announcement.
      await vi.advanceTimersByTimeAsync(RETRY_MS);
      expect(await ensureServerList()).toBe("fallback");
      expect(backendReachable()).toBe(true);
      expect(seen).toEqual([{ reachable: true }]);

      // A network error is not an answer.
      fetchMock.mockRejectedValue(new TypeError("network down"));
      await vi.advanceTimersByTimeAsync(RETRY_MS);
      expect(await ensureServerList()).toBe("fallback");
      expect(backendReachable()).toBe(false);
      expect(seen).toEqual([{ reachable: true }, { reachable: false }]);

      // Back up again.
      fetchMock.mockImplementation(async () => jsonResponse(API_LIST));
      await vi.advanceTimersByTimeAsync(RETRY_MS);
      expect(await ensureServerList()).toBe("api");
      expect(backendReachable()).toBe(true);
      expect(seen).toEqual([
        { reachable: true },
        { reachable: false },
        { reachable: true },
      ]);
    } finally {
      document.removeEventListener("backend-reachability", listener);
    }
  });
});

// Today's rollover feel, kept: a player on build X keeps playing on X's
// server after Y is released, until they refresh. So the pick prefers an
// `open` server on this build, falls back to a `draining` one on this
// build, and never takes a `fenced` one. When neither state runs this
// build the page is told a newer version exists ("outdated") and the
// update prompt handles it — nothing here ever navigates the page.
describe("picking between open, draining and fenced", () => {
  // `latest: null` is a list with no latest flagged at all (a preview
  // whose server expired), which is not the same as leaving it out here.
  function listOf(
    servers: Record<string, unknown>,
    latest: string | null = OWN,
  ) {
    return latest === null ? { servers } : { latest, servers };
  }
  const server = (
    version: string,
    state: string,
    host = "falk2-a.openfront.io",
  ) => ({
    host,
    numWorkers: 16,
    version,
    state,
  });

  it("routes to a draining server on my build when nothing open runs it", async () => {
    // Mid-rollover: the new build's server is open, mine is draining. I
    // stay on mine — my games and the lobbies I see all live there.
    setBootstrap({ gitCommit: OLD });
    const loc = stubLocation("openfront.io");
    expect(await ensureServerList()).toBe("api");
    expect(ClientEnv.serverWsBase()).toBe("wss://falk2-a.openfront.io");
    expect(ClientEnv.serverHttpBase()).toBe("https://falk2-a.openfront.io");
    expect(loc.href).toBe("https://openfront.io/");
  });

  it("prefers an open server over a draining one on my build", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        listOf({
          c: server(OWN, "draining"),
          d: server(OWN, "open", "falk2-b.openfront.io"),
        }),
      ),
    );
    expect(await ensureServerList()).toBe("api");
    expect(ClientEnv.serverHttpBase()).toBe("https://falk2-b.openfront.io");
  });

  it("never picks a fenced server, and says so when it is the only one on my build", async () => {
    // Fenced takes nothing new even from the build it runs, so there is no
    // server for this page; latest names a build it could move to.
    setBootstrap({ gitCommit: OLD });
    const loc = stubLocation("openfront.io", "/w1/game/cAbCd12345", "?lobby");
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        listOf({
          c: server(OLD, "fenced"),
          d: server(OWN, "open", "falk2-b.openfront.io"),
        }),
      ),
    );
    expect(await ensureServerList()).toBe("outdated");
    // The prompt navigates, not this: the page is left exactly where it is.
    expect(loc.href).toBe("https://openfront.io/w1/game/cAbCd12345?lobby");
    // Own-server calls fall back to the page's own values...
    expect(ClientEnv.serverWsBase()).toBe("wss://blue.openfront.io");
    // ...and existing games still resolve by letter from the list.
    expect(ClientEnv.resolveGame("cAbCd12345")).toEqual({
      kind: "cross",
      host: "falk2-a.openfront.io",
      numWorkers: 16,
    });
  });

  it("reports no-server when I am latest, or the list names no latest", async () => {
    // Nothing my build can use and I AM latest: nothing is running.
    // Multiplayer fails as it does today; there is no newer version to
    // prompt for.
    const loc = stubLocation("openfront.io");
    fetchMock.mockImplementation(async () =>
      jsonResponse(listOf({ c: server(OWN, "fenced") })),
    );
    expect(await ensureServerList()).toBe("no-server");
    expect(loc.href).toBe("https://openfront.io/");
    expect(ClientEnv.serverWsBase()).toBe("wss://blue.openfront.io");

    setBootstrap({ gitCommit: OLD });
    fetchMock.mockImplementation(async () =>
      jsonResponse(listOf({ c: server(OLD, "fenced") }, null)),
    );
    expect(await ensureServerList()).toBe("no-server");
    expect(loc.href).toBe("https://openfront.io/");
  });

  // A build label that names no commit matches any server version, so it is
  // never behind latest: prompting the dev server's bundle to reload for an
  // update it has no way to fetch would only loop.
  it("is never outdated on a build whose version names no commit", async () => {
    for (const label of ["DEV", "desktop", ""]) {
      setBootstrap({ gitCommit: label });
      const loc = stubLocation("openfront.io");
      fetchMock.mockImplementation(async () =>
        jsonResponse(listOf({ c: server(OLD, "fenced") })),
      );
      expect(await ensureServerList()).toBe("no-server");
      expect(loc.href).toBe("https://openfront.io/");
    }
  });

  // replay.<domain> serves the build a record was made on: being behind
  // latest is the whole point of the page, and re-serving the same
  // immutable shell would prompt forever.
  it("leaves a replay shell on its pinned build", async () => {
    setBootstrap({ gitCommit: OLD });
    const loc = stubLocation("replay.openfront.io", "/dAbCd12345");
    fetchMock.mockImplementation(async () =>
      jsonResponse(listOf({ c: server(OLD, "fenced") })),
    );
    expect(await ensureServerList()).toBe("no-server");
    expect(loc.href).toBe("https://replay.openfront.io/dAbCd12345");
  });

  // The desktop shell updates itself (download, stage, its own reload
  // button): a web-style update prompt there would re-run the same overlay.
  it("leaves the desktop shell to its updater", async () => {
    (window as any).openfrontDesktop = {};
    setBootstrap({ gitCommit: OLD, serverHost: "openfront.io" });
    const loc = stubLocation("openfront");
    fetchMock.mockImplementation(async () =>
      jsonResponse(listOf({ c: server(OLD, "fenced") })),
    );
    expect(await ensureServerList()).toBe("no-server");
    expect(loc.href).toBe("https://openfront/");
    expect(ClientEnv.serverWsBase()).toBe("wss://openfront.io");
  });

  // Whatever the answer, and whoever asked: joining an existing game and
  // every in-game request run through here too, and a navigation would take
  // a live match off the page.
  it("never navigates the page, on any path", async () => {
    const cases: unknown[] = [
      listOf({ c: server(OLD, "fenced") }),
      listOf({ c: server(OLD, "draining") }),
      listOf({ c: server(OWN, "open") }),
      listOf({}, null),
    ];
    for (const body of cases) {
      for (const commit of [OWN, OLD, "DEV"]) {
        setBootstrap({ gitCommit: commit });
        const loc = stubLocation("openfront.io", `/v/${OWN}/game/cAbCd12345`);
        fetchMock.mockImplementation(async () => jsonResponse(body));
        await ensureServerList();
        expect(loc.href).toBe(`https://openfront.io/v/${OWN}/game/cAbCd12345`);
      }
    }
  });
});
