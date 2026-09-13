import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import { resetPagePinForTests } from "../../src/client/PagePin";
import {
  backendReachable,
  ensureServerList,
  redirectToGameVersion,
  reloadWouldRescue,
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
// What `/v/<commit>/` carries: the bucket layout and the static Worker both
// key on the first 7 characters (see shortCommit).
const SHORT_OLD = "5ccc50a";

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

// A page the static Worker served: the environment values and nothing that
// names a server — no serverHost, no cluster map, no instanceLetter, no
// instanceId. Reloading a page like this really does fetch `latest`, which
// is what makes the list's "outdated" answer meaningful; a page a game
// server rendered is re-served by that same server on the same build, so it
// is never outdated (ClientEnv.servedByGameServer).
function setWorkerBootstrap(overrides: Record<string, unknown> = {}) {
  setBootstrap({
    cluster: undefined,
    instanceLetter: undefined,
    serverHost: undefined,
    siteHost: undefined,
    instanceId: undefined,
    ...overrides,
  });
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
  // isPinnedToAVersion answers from the pin captured at boot (PagePin.ts),
  // so a restubbed location only counts once the captured value is dropped.
  resetPagePinForTests();
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
    // server for this page; latest names a build it could move to. Told to
    // a Worker-served page, whose reload fetches latest — the only kind
    // "outdated" is ever said to.
    setWorkerBootstrap({ gitCommit: OLD });
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
    // Own-server calls fall back to the page's own values — here the
    // document's origin, the only thing a Worker-served page has...
    expect(ClientEnv.serverWsBase()).toBe("wss://openfront.io");
    // ...and existing games still resolve by letter from the list.
    expect(ClientEnv.resolveGame("cAbCd12345")).toEqual({
      kind: "cross",
      host: "falk2-a.openfront.io",
      numWorkers: 16,
    });
  });

  // A page under /v/<commit>/ needs no special pick: its build's servers are
  // `draining`, not `fenced`, so the ordinary "open, else draining, on my
  // build" rule already routes it to one. This is why the pinned page has no
  // branch of its own.
  it("routes a pinned page to its own build's draining server like any other", async () => {
    setBootstrap({ gitCommit: OLD });
    stubLocation("openfront.io", `/v/${OLD}/game/cAbCd12345`);
    expect(await ensureServerList()).toBe("api");
    expect(ClientEnv.serverHttpBase()).toBe("https://falk2-a.openfront.io");
    expect(ClientEnv.numWorkers()).toBe(16);
  });

  // What a pinned page DOES need: never to be told it is outdated. It is
  // pinned on purpose, so being behind `latest` is its permanent condition
  // rather than news — the prompt would fire on every visit, and its remedy
  // (reloadForUpdate, which strips the prefix) would silently undo the pin
  // the player asked for. Leaving is already one click away: "leave to the
  // menu" goes to the version-free root. Same exemption, for the same
  // reason, as the desktop and replay shells.
  it("never reports outdated on a page pinned under /v/<commit>/", async () => {
    // Worker-served, so the pin is the only thing holding "outdated" back.
    setWorkerBootstrap({ gitCommit: OLD });
    const loc = stubLocation(
      "openfront.io",
      `/v/${OLD}/game/cAbCd12345`,
      "?lobby",
    );
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        listOf({
          c: server(OLD, "fenced"),
          d: server(OWN, "open", "falk2-b.openfront.io"),
        }),
      ),
    );
    expect(await ensureServerList()).toBe("no-server");
    expect(loc.href).toBe(
      `https://openfront.io/v/${OLD}/game/cAbCd12345?lobby`,
    );
    // Existing games still resolve by letter, so the pinned page can still
    // rejoin the game it was opened for.
    expect(ClientEnv.resolveGame("cAbCd12345")).toEqual({
      kind: "cross",
      host: "falk2-a.openfront.io",
      numWorkers: 16,
    });
  });

  it("still reports outdated for the same list on an unpinned page", async () => {
    // The pin is the only difference from the test above.
    setWorkerBootstrap({ gitCommit: OLD });
    stubLocation("openfront.io", "/game/cAbCd12345");
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        listOf({
          c: server(OLD, "fenced"),
          d: server(OWN, "open", "falk2-b.openfront.io"),
        }),
      ),
    );
    expect(await ensureServerList()).toBe("outdated");
  });

  it("reports no-server when I am latest, or the list names no latest", async () => {
    // Nothing my build can use and I AM latest: nothing is running.
    // Multiplayer fails as it does today; there is no newer version to
    // prompt for.
    setWorkerBootstrap();
    const loc = stubLocation("openfront.io");
    fetchMock.mockImplementation(async () =>
      jsonResponse(listOf({ c: server(OWN, "fenced") })),
    );
    expect(await ensureServerList()).toBe("no-server");
    expect(loc.href).toBe("https://openfront.io/");
    expect(ClientEnv.serverWsBase()).toBe("wss://openfront.io");

    setWorkerBootstrap({ gitCommit: OLD });
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
      setWorkerBootstrap({ gitCommit: label });
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
    // The shell host is the guard under test, so this fixture names no
    // server; a replay shell that injects one is answered earlier by the
    // page-server rule, to the same effect — no prompt.
    setWorkerBootstrap({ gitCommit: OLD });
    const loc = stubLocation("replay.openfront.io", "/dAbCd12345");
    fetchMock.mockImplementation(async () =>
      jsonResponse(listOf({ c: server(OLD, "fenced") })),
    );
    expect(await ensureServerList()).toBe("no-server");
    expect(loc.href).toBe("https://replay.openfront.io/dAbCd12345");
  });

  // The desktop shell updates itself (download, stage, its own reload
  // button): a web-style update prompt there would re-run the same overlay.
  // It also injects a serverHost of its own, so it is answered by the
  // page-server rule first — "fallback", the shell's own values, never
  // "outdated". The isDesktopShell() exemption still covers a shell that
  // injects no host at all.
  it("leaves the desktop shell to its updater", async () => {
    (window as any).openfrontDesktop = {};
    setBootstrap({ gitCommit: OLD, serverHost: "openfront.io" });
    const loc = stubLocation("openfront");
    fetchMock.mockImplementation(async () =>
      jsonResponse(listOf({ c: server(OLD, "fenced") })),
    );
    expect(await ensureServerList()).toBe("fallback");
    expect(loc.href).toBe("https://openfront/");
    expect(ClientEnv.serverWsBase()).toBe("wss://openfront.io");
  });

  // OPE-430. Live on main.openfront.dev: the page was still rendered by a
  // game server (the static Worker is not routed yet), a deploy failed to
  // register the new build in the API's registry, so the list carried no
  // server on the page's build and a `latest` that was a different commit.
  // The page was told "outdated", the prompt reloaded it, the same server
  // served the same page, and it prompted again — forever.
  //
  // The rule: a page that names a server came FROM a server running this
  // build, and a reload re-fetches the page from that same host, so the
  // list can never make it outdated — whatever it says about that host.
  // The answer is always "fallback": the page's own server and its own
  // values, exactly as when the API is unreachable.
  describe("a page a game server rendered", () => {
    // No server on the page's build, and a latest that is a different
    // commit: exactly the list that used to say "outdated".
    const nothingOnMyBuild = () =>
      listOf({
        c: server(OLD, "fenced"),
        d: server(OWN, "open", "falk2-b.openfront.io"),
      });

    beforeEach(() => {
      fetchMock.mockImplementation(async () =>
        jsonResponse(nothingOnMyBuild()),
      );
    });

    it("answers fallback and keeps the server that served it (serverHost)", async () => {
      setBootstrap({ gitCommit: OLD, serverHost: "blue.openfront.io" });
      const loc = stubLocation("openfront.io", "/", "");

      expect(await ensureServerList()).toBe("fallback");
      // Own-server calls go to the page's own server: it is running this
      // build — it served this page.
      expect(ClientEnv.serverHttpBase()).toBe("https://blue.openfront.io");
      expect(ClientEnv.serverWsBase()).toBe("wss://blue.openfront.io");
      // "fallback" here is not "no list": the list IS applied, so a foreign
      // letter still routes cross-host.
      expect(ClientEnv.serverListLoaded()).toBe(true);
      expect(ClientEnv.resolveGame("dAbCd12345")).toEqual({
        kind: "cross",
        host: "falk2-b.openfront.io",
        numWorkers: 16,
      });
      // And nothing navigated: no prompt, no reload, no loop.
      expect(loc.href).toBe("https://openfront.io/");
    });

    it("answers fallback with only a cluster map and its own letter", async () => {
      // A web page a game server rendered carries no serverHost — the map
      // plus its own letter are what name its server.
      setBootstrap({
        gitCommit: OLD,
        serverHost: undefined,
        siteHost: undefined,
      });
      stubLocation("blue.openfront.io");

      expect(await ensureServerList()).toBe("fallback");
      // Its own server is the document's origin, and the worker count comes
      // from its own entry in the injected map.
      expect(ClientEnv.serverHttpBase()).toBe("https://blue.openfront.io");
      expect(ClientEnv.numWorkers()).toBe(2);
      expect(ClientEnv.serverListLoaded()).toBe(true);
      expect(ClientEnv.resolveGame("dAbCd12345")).toEqual({
        kind: "cross",
        host: "falk2-b.openfront.io",
        numWorkers: 16,
      });
    });

    // Review round 6's scenario. The list DOES carry this page's host, on a
    // different build. Right after a deploy that is registration lag — the
    // page came from the NEW build while the registry still names the old
    // one — and on a tab left open across a deploy the host really has
    // moved on. The list cannot tell the two apart, and a reload re-serves
    // this same page in the first case, so neither is "outdated" here. The
    // stale tab is told by the server itself: the lobby feed's commit
    // compare fires as soon as the socket connects to that very host.
    it("is not outdated when the list puts its own host on another build", async () => {
      setBootstrap({ gitCommit: OLD, serverHost: "blue.openfront.io" });
      fetchMock.mockImplementation(async () =>
        jsonResponse(listOf({ a: server(OWN, "open", "blue.openfront.io") })),
      );

      expect(await ensureServerList()).toBe("fallback");
      expect(ClientEnv.serverHttpBase()).toBe("https://blue.openfront.io");
    });

    // The same list shape on a standalone deployment with GAME_DOMAIN set:
    // its page host (main.openfront.dev) and game host
    // (main.server.openfront.dev) differ, but both reach the one container.
    it("is not outdated on a standalone page whose page and game hosts differ", async () => {
      setBootstrap({
        gitCommit: OLD,
        siteHost: "main.openfront.dev",
        serverHost: "main.server.openfront.dev",
        instanceLetter: "a",
        cluster: {
          a: {
            host: "main.server.openfront.dev",
            color: "blue",
            numWorkers: 2,
          },
        },
      });
      fetchMock.mockImplementation(async () =>
        jsonResponse(
          listOf({ a: server(OWN, "open", "main.server.openfront.dev") }),
        ),
      );

      expect(await ensureServerList()).toBe("fallback");
      expect(ClientEnv.serverHttpBase()).toBe(
        "https://main.server.openfront.dev",
      );
    });

    // Review round 7's scenario: registration lag on an apex page. The
    // registry still names a stale version for this page's own host while
    // `latest` already IS this page's build, so nothing in the list serves
    // it and the page is not behind either. Under the per-standing rules
    // this fell through to "no-server" and Create was refused on a server
    // that was alive, correctly built, and had just rendered the page.
    // There is no such fall-through now: a page that names a server answers
    // "fallback", so Create goes to its own host (GameServerApiCallers) and
    // nothing prompts, at page load or after a socket failure.
    it("creates on its own server when the registry lags and this build is latest", async () => {
      setBootstrap({ gitCommit: OWN, serverHost: "blue.openfront.io" });
      fetchMock.mockImplementation(async () =>
        jsonResponse(listOf({ a: server(OLD, "open", "blue.openfront.io") })),
      );

      expect(await ensureServerList()).toBe("fallback");
      expect(ClientEnv.serverHttpBase()).toBe("https://blue.openfront.io");
      // Nor is there anything a reload could rescue: this page IS latest.
      expect(reloadWouldRescue("fallback")).toBe(false);
    });

    // Review round 5's fenced case. The page's own server, on its own
    // build, deliberately out of rotation: it takes nothing new, but a
    // reload would come back identical, so there is nothing to prompt for.
    // Create goes to that host as it did before the list existed
    // (Api.createLobby), and the deployment tells its own tabs it is on its
    // way out over the feed it is already serving them — active:false, once
    // the API stops calling it open (ClusterCheckin.applyCheckinState).
    it("is not outdated when its own entry is fenced on this build", async () => {
      setBootstrap({ gitCommit: OLD, serverHost: "blue.openfront.io" });
      fetchMock.mockImplementation(async () =>
        jsonResponse(
          listOf({
            a: server(OLD, "fenced", "blue.openfront.io"),
            d: server(OWN, "open", "falk2-b.openfront.io"),
          }),
        ),
      );

      expect(await ensureServerList()).toBe("fallback");
      expect(ClientEnv.serverHttpBase()).toBe("https://blue.openfront.io");
    });
  });

  // The sticky pick, end to end: the page holds the server it picked while
  // that server still takes its games, so the lobby list and the games
  // created from it land together. Each of these refreshes the list under a
  // page that has already picked `d`.
  describe("the sticky pick across refreshes", () => {
    const START = listOf({
      c: server(OLD, "draining"),
      d: server(OWN, "open", "falk2-b.openfront.io"),
    });

    async function refreshWith(body: unknown): Promise<string> {
      fetchMock.mockImplementation(async () => jsonResponse(body));
      // Stale the cache, answer from it (which kicks the refresh), then let
      // that refresh land before asking again.
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 1);
      await ensureServerList();
      await vi.advanceTimersByTimeAsync(1);
      return ensureServerList();
    }

    beforeEach(async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async () => jsonResponse(START));
      expect(await ensureServerList()).toBe("api");
      expect(ClientEnv.serverHttpBase()).toBe("https://falk2-b.openfront.io");
    });

    it("holds the pick when its server flips to draining on my build", async () => {
      // d still runs my build, so my games still belong there — even though
      // e is open and would win a fresh draw. Moving the page mid-session
      // is exactly the rollover players don't get today.
      expect(
        await refreshWith(
          listOf({
            c: server(OLD, "draining"),
            d: server(OWN, "draining", "falk2-b.openfront.io"),
            e: server(OWN, "open", "nbg2-a.openfront.io"),
          }),
        ),
      ).toBe("api");
      expect(ClientEnv.serverHttpBase()).toBe("https://falk2-b.openfront.io");
    });

    it("re-picks when its server is fenced", async () => {
      // Fenced takes nothing new, not even from the build it runs.
      expect(
        await refreshWith(
          listOf({
            d: server(OWN, "fenced", "falk2-b.openfront.io"),
            e: server(OWN, "open", "nbg2-a.openfront.io"),
          }),
        ),
      ).toBe("api");
      expect(ClientEnv.serverHttpBase()).toBe("https://nbg2-a.openfront.io");
    });

    it("re-picks when its letter leaves the list", async () => {
      expect(
        await refreshWith(
          listOf({ e: server(OWN, "open", "nbg2-a.openfront.io") }),
        ),
      ).toBe("api");
      expect(ClientEnv.serverHttpBase()).toBe("https://nbg2-a.openfront.io");
    });
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

// The POST-FAILURE question (ServerList.reloadWouldRescue), asked by
// PublicLobbySocket.promptIfOutdated once reconnecting has given up: would
// reloading actually rescue this tab? Its three conditions are the three
// ways this could go wrong, and each of these cases is a scenario a review
// round raised against an earlier draft of this PR.
describe("reloadWouldRescue", () => {
  // A newer build exists, and nothing serves this page's build.
  const NEWER = {
    latest: OWN,
    servers: {
      d: {
        host: "falk2-b.openfront.io",
        numWorkers: 16,
        version: OWN,
        state: "open",
      },
    },
  };
  // The same, plus a draining server this page's build can still use.
  const STILL_SERVED = {
    latest: OWN,
    servers: {
      ...NEWER.servers,
      c: {
        host: "falk2-a.openfront.io",
        numWorkers: 16,
        version: OLD,
        state: "draining",
      },
    },
  };

  beforeEach(() => {
    fetchMock.mockImplementation(async () => jsonResponse(NEWER));
  });

  it("rescues a deployment that was drained, then fenced or removed", async () => {
    // A tab that was already sitting on the homepage gets no feed to learn
    // from — it just watches its socket fail. Behind the apex the reload
    // re-enters through the site host, which the load balancer answers from
    // a live deployment, so this is a rescue and not a loop. (The page-load
    // status for this very page and list is "fallback": the two questions
    // differ, and this is the pair that shows it.)
    setBootstrap({ gitCommit: OLD });
    expect(await ensureServerList()).toBe("fallback");
    expect(reloadWouldRescue("fallback")).toBe(true);
  });

  it("never rescues while the list still serves this build", async () => {
    // A picked server still takes this build's games, so a socket failing
    // against it is a network blip — and being behind `latest` is the
    // normal state of every tab for the length of a rollout, so prompting
    // here would turn every hiccup in that window into a forced reload.
    setBootstrap({ gitCommit: OLD });
    fetchMock.mockImplementation(async () => jsonResponse(STILL_SERVED));
    expect(await ensureServerList()).toBe("api");
    expect(reloadWouldRescue("api")).toBe(false);
  });

  it("never rescues a standalone page, whose reload comes back from the same server", async () => {
    // dev's main.openfront.dev today, previews, beta. If that server is
    // gone the reload fails with it; if it is alive with a WebSocket-only
    // problem (a proxy passing HTTP while blocking upgrades) the prompt
    // would reload, come back to the same container and prompt again —
    // OPE-430, paced by maxWsAttempts.
    setBootstrap({
      gitCommit: OLD,
      siteHost: undefined,
      serverHost: "main.openfront.dev",
      instanceLetter: "a",
      cluster: { a: { host: "main.openfront.dev", numWorkers: 2 } },
    });
    stubLocation("main.openfront.dev");
    expect(await ensureServerList()).toBe("fallback");
    expect(reloadWouldRescue("fallback")).toBe(false);
  });

  it("never rescues a single-server deployment whose page and game hosts differ", async () => {
    // With GAME_DOMAIN set even a standalone deployment gets a siteHost
    // that differs from its game host, while Traefik routes both names to
    // the one container. The map having no siblings is what tells this
    // apart from prod's apex — the same rule the server's own apex poll
    // uses (ActiveDeployment.shouldPollApex).
    setBootstrap({
      gitCommit: OLD,
      siteHost: "main.openfront.dev",
      serverHost: "main.server.openfront.dev",
      instanceLetter: "a",
      cluster: { a: { host: "main.server.openfront.dev", numWorkers: 2 } },
    });
    expect(await ensureServerList()).toBe("fallback");
    expect(reloadWouldRescue("fallback")).toBe(false);
  });

  it("asks no network question: this is topology, not liveness", async () => {
    // Probing the page's own server cannot answer it. The master's
    // /api/health sends no CORS headers, so a cross-origin probe fails
    // whatever the server's state, and an opaque (no-cors) response carries
    // no status at all — a proxy answering 521 for a torn-down origin and a
    // healthy server look the same. Only the list is ever fetched.
    setBootstrap({ gitCommit: OLD });
    expect(await ensureServerList()).toBe("fallback");
    fetchMock.mockClear();

    expect(reloadWouldRescue("fallback")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is false before any list has loaded", () => {
    // Nothing is known to update to, so nothing can be promised.
    expect(reloadWouldRescue("fallback")).toBe(false);
  });

  it("is false when this page already runs latest", async () => {
    setBootstrap({ gitCommit: OWN });
    await ensureServerList();
    expect(reloadWouldRescue("fallback")).toBe(false);
  });

  it("is false when the list names no latest", async () => {
    setBootstrap({ gitCommit: OLD });
    fetchMock.mockImplementation(async () =>
      jsonResponse({ servers: NEWER.servers }),
    );
    await ensureServerList();
    expect(reloadWouldRescue("fallback")).toBe(false);
  });

  it("keeps the exemptions of the shells that must never reload", async () => {
    // A pinned page is behind on purpose, and the desktop shell's updater
    // owns its version: a dead socket is no reason to tell either to
    // reload.
    setBootstrap({ gitCommit: OLD });
    stubLocation("openfront.io", `/v/${OLD}/game/dAbCd12345`);
    await ensureServerList();
    expect(reloadWouldRescue("fallback")).toBe(false);

    (window as any).openfrontDesktop = {};
    setBootstrap({ gitCommit: OLD, serverHost: "openfront.io" });
    stubLocation("openfront");
    await ensureServerList();
    expect(reloadWouldRescue("fallback")).toBe(false);
  });

  it("rescues a Worker-served page, whose reload fetches latest", async () => {
    // It names no server, so a reload is by definition somewhere else —
    // and this is the page the page-load path already answers "outdated".
    setWorkerBootstrap({ gitCommit: OLD });
    expect(await ensureServerList()).toBe("outdated");
    expect(reloadWouldRescue("outdated")).toBe(true);
  });
});

// Opening a game whose server runs another build. One exported decision for
// both call sites (Main.handleUrl, JoinLobbyModal.checkActiveLobby) so the
// shells that must not be navigated cannot be remembered in one and
// forgotten in the other.
describe("redirectToGameVersion", () => {
  // Letter c runs OLD in API_LIST; the page is built from OWN.
  async function withList() {
    expect(await ensureServerList()).toBe("api");
  }

  it("navigates to the page of the version the game's server runs", async () => {
    const loc = stubLocation("openfront.io", "/game/cAbCd12345", "?lobby");
    await withList();
    expect(redirectToGameVersion("cAbCd12345")).toBe(true);
    expect(loc.href).toBe(`/v/${SHORT_OLD}/game/cAbCd12345?lobby`);
  });

  // The path is built from the GAME, not from the address bar:
  // checkActiveLobby also runs from the homepage (a typed or pasted code, a
  // click in the lobby list) and from a page showing a different game.
  it("builds the game's own path when the address bar is elsewhere", async () => {
    const loc = stubLocation("openfront.io", "/");
    await withList();
    expect(redirectToGameVersion("cAbCd12345")).toBe(true);
    expect(loc.href).toBe(`/v/${SHORT_OLD}/game/cAbCd12345`);

    const other = stubLocation("openfront.io", "/game/dAbCd12345", "?spectate");
    await withList();
    expect(redirectToGameVersion("cAbCd12345")).toBe(true);
    expect(other.href).toBe(`/v/${SHORT_OLD}/game/cAbCd12345`);
  });

  it("stays put when the game's server runs this build", async () => {
    const loc = stubLocation("openfront.io", "/game/dAbCd12345");
    await withList();
    expect(redirectToGameVersion("dAbCd12345")).toBe(false);
    expect(loc.href).toBe("https://openfront.io/game/dAbCd12345");
  });

  it("stays put with no list loaded", async () => {
    const loc = stubLocation("openfront.io", "/game/cAbCd12345");
    expect(redirectToGameVersion("cAbCd12345")).toBe(false);
    expect(loc.href).toBe("https://openfront.io/game/cAbCd12345");
  });

  it("never navigates the desktop shell", async () => {
    const loc = stubLocation("openfront.io", "/game/cAbCd12345");
    await withList();
    (window as any).openfrontDesktop = {};
    expect(redirectToGameVersion("cAbCd12345")).toBe(false);
    expect(loc.href).toBe("https://openfront.io/game/cAbCd12345");
  });

  // replay.<domain> serves the build a record was made on and has no
  // /v/<commit>/ routes at all, so navigating there would 404 and lose an
  // archived replay. It does load the site's list (siteHost is injected),
  // so nothing else would stop it.
  it("never navigates a replay shell", async () => {
    const loc = stubLocation("replay.openfront.io", "/cAbCd12345");
    await withList();
    expect(redirectToGameVersion("cAbCd12345")).toBe(false);
    expect(loc.href).toBe("https://replay.openfront.io/cAbCd12345");
  });
});
