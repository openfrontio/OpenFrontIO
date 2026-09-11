import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import {
  ensureServerList,
  resetServerList,
  serverListSite,
  serverListUrl,
} from "../../src/client/ServerList";

// Priority 1 of the multi-server v2 handoff: the client fetches the server
// list from the API only when it needs a server, filters it by its own
// version, and falls back to BOOTSTRAP_CONFIG whenever the list is missing
// or unreachable so that production behaves exactly as today until the API
// serves it.

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

  it("reuses a fresh list instead of fetching again", async () => {
    await ensureServerList();
    await ensureServerList();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe("when no open server runs the client's version", () => {
  it("sends an out-of-date web client to /v/<latest>/, keeping the game path", async () => {
    setBootstrap({ gitCommit: OLD });
    const loc = stubLocation("openfront.io", "/w1/game/cAbCd12345", "?lobby");
    expect(await ensureServerList()).toBe("redirecting");
    expect(loc.href).toBe("/v/" + OWN + "/game/cAbCd12345?lobby");
  });

  it("never redirects when the client is latest, or the list has no latest", async () => {
    // Nothing open for our version and we ARE latest: no server is running
    // at all. Multiplayer fails as it does today; a redirect would loop.
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        latest: OWN,
        servers: { c: { ...API_LIST.servers.c } },
      }),
    );
    const loc = stubLocation("openfront.io");
    expect(await ensureServerList()).toBe("no-server");
    expect(loc.href).toBe("https://openfront.io/");
    // Own-server calls fall back to the page's own values, as today.
    expect(ClientEnv.serverWsBase()).toBe("wss://blue.openfront.io");
    // ...but existing games still resolve from the list.
    expect(ClientEnv.resolveGame("cAbCd12345")).toEqual({
      kind: "cross",
      host: "falk2-a.openfront.io",
      numWorkers: 16,
    });

    setBootstrap({ gitCommit: OLD });
    fetchMock.mockImplementation(async () =>
      jsonResponse({ servers: { c: { ...API_LIST.servers.c } } }),
    );
    expect(await ensureServerList()).toBe("no-server");
    expect(loc.href).toBe("https://openfront.io/");
  });

  it("never redirects a page already under /v/<latest>/", async () => {
    setBootstrap({ gitCommit: OLD });
    const loc = stubLocation("openfront.io", `/v/${OWN}/`);
    expect(await ensureServerList()).toBe("no-server");
    expect(loc.href).toBe(`https://openfront.io/v/${OWN}/`);
  });

  it("leaves the desktop shell to its updater", async () => {
    (window as any).openfrontDesktop = {};
    setBootstrap({ gitCommit: OLD, serverHost: "openfront.io" });
    const loc = stubLocation("openfront");
    expect(await ensureServerList()).toBe("no-server");
    expect(loc.href).toBe("https://openfront/");
    expect(ClientEnv.serverWsBase()).toBe("wss://openfront.io");
  });
});
