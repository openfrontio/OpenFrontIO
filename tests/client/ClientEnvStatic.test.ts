import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientEnv, NoServerError } from "../../src/client/ClientEnv";
import { GameEnv } from "../../src/core/configuration/Config";
import { ServerList } from "../../src/core/ServerList";

// Multi-server v2, roadmap item 2 (docs/MultiServer.md): the page becomes a
// static file built once per version and served to everyone, so it carries
// only the values that are the same for every player — the environment, the
// Turnstile key, the API audience and the commit it was built from. Nothing
// in it names a server: which server to talk to is what the API's list
// answers. This file pins that a page like that boots.

const OWN = "bfd5563a11111111111111111111111111111111";
const OTHER = "5ccc50a722222222222222222222222222222222";

const LIST: ServerList = {
  latest: OWN,
  servers: {
    c: {
      host: "falk2-a.openfront.io",
      numWorkers: 16,
      version: OTHER,
      state: "draining",
    },
    d: {
      host: "falk2-b.openfront.io",
      numWorkers: 8,
      version: OWN,
      state: "open",
    },
  },
};

function staticPage() {
  ClientEnv.reset();
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    turnstileSiteKey: "site-key",
    jwtAudience: "openfront.io",
    gitCommit: OWN,
  };
}

function stubLocation(host: string) {
  Object.defineProperty(window, "location", {
    value: {
      protocol: "https:",
      host,
      hostname: host,
      pathname: "/",
      search: "",
      href: `https://${host}/`,
    },
    writable: true,
    configurable: true,
  });
}

describe("a page carrying only environment values", () => {
  beforeEach(() => {
    staticPage();
    stubLocation("openfront.io");
  });

  afterEach(() => {
    ClientEnv.reset();
    delete (window as any).BOOTSTRAP_CONFIG;
  });

  it("boots: the environment values all answer", () => {
    expect(ClientEnv.env()).toBe(GameEnv.Prod);
    expect(ClientEnv.gitCommit()).toBe(OWN);
    expect(ClientEnv.jwtAudience()).toBe("openfront.io");
    expect(ClientEnv.turnstileSiteKey()).toBe("site-key");
    expect(ClientEnv.jwtIssuer()).toBe("https://api.openfront.io");
  });

  it("reports no instance id rather than throwing", () => {
    // Only a server that renders the page knows its own instance id. A
    // static page has none, and the API ignores the value anyway
    // (docs/MultiServer.md), so callers send it only when it is there.
    expect(ClientEnv.instanceId()).toBe("");
  });

  it("has no per-server values", () => {
    expect(ClientEnv.cluster()).toBeUndefined();
    expect(ClientEnv.instanceLetter()).toBeUndefined();
    expect(ClientEnv.serverHost()).toBeUndefined();
    expect(ClientEnv.siteHost()).toBeUndefined();
    expect(ClientEnv.siteOrigin()).toBeUndefined();
  });

  it("throws NoServerError from the accessors that genuinely have no answer", () => {
    // A worker count is a property of one server; with no list loaded and
    // nothing injected, no number is the right answer, so callers get a
    // typed failure they can route into the connection-error path instead
    // of a silent wrong route.
    expect(() => ClientEnv.numWorkers()).toThrow(NoServerError);
    expect(() => ClientEnv.workerPath("dAbCd12345")).toThrow(NoServerError);
    expect(() => ClientEnv.workerIndex("dAbCd12345")).toThrow(NoServerError);
  });

  it("still answers same-origin for the socket and HTTP bases", () => {
    // Deliberately asymmetric with numWorkers above: a dev or standalone
    // deployment serves the game from the document's own origin, and that
    // is the historical answer when nothing was injected. Keeping it means
    // `npm run dev` and single-box deployments behave as they always have.
    expect(ClientEnv.serverWsBase()).toBe("wss://openfront.io");
    expect(ClientEnv.serverHttpBase()).toBe("https://openfront.io");
  });

  it("answers from the list once it is applied", () => {
    ClientEnv.applyServerList(LIST, "d");
    expect(ClientEnv.numWorkers()).toBe(8);
    expect(ClientEnv.serverWsBase()).toBe("wss://falk2-b.openfront.io");
    expect(ClientEnv.serverHttpBase()).toBe("https://falk2-b.openfront.io");
    // A foreign letter still routes to its own server, with its own worker
    // count, exactly as it does with an injected cluster map.
    expect(ClientEnv.gameHttpBase("cAbCd12345")).toBe(
      "https://falk2-a.openfront.io",
    );
    expect(ClientEnv.resolveGame("cAbCd12345")).toEqual({
      kind: "cross",
      host: "falk2-a.openfront.io",
      numWorkers: 16,
    });
  });

  it("builds a version-free share path, with a worker prefix only when one is known", () => {
    // Both shapes are served (the SPA fallback and the static Worker), and
    // the join flow re-resolves the worker from the id — so a page that
    // cannot know a worker count still hands out a working link.
    expect(ClientEnv.gamePath("dAbCd12345")).toBe("/game/dAbCd12345");

    ClientEnv.applyServerList(LIST, "d");
    // Own letter: this page's picked server answers the count.
    expect(ClientEnv.gamePath("dAbCd12345")).toMatch(
      /^\/w\d+\/game\/dAbCd12345$/,
    );
    // Foreign letter: its own server's count, not ours.
    expect(ClientEnv.gamePath("cAbCd12345")).toMatch(
      /^\/w\d+\/game\/cAbCd12345$/,
    );
    // A letter no list knows falls back to this page's own count, as every
    // id did before letters existed. The link still resolves: the join flow
    // re-resolves the worker from the id, and an id whose letter nothing
    // serves lands in the not-found path either way.
    expect(ClientEnv.gamePath("zAbCd12345")).toMatch(
      /^\/w\d+\/game\/zAbCd12345$/,
    );
  });

  it("reports the version of the server a game lives on", () => {
    // Undefined until a list is loaded: without one nothing knows what the
    // game's server runs, and the web client must not navigate on a guess.
    expect(ClientEnv.gameVersion("cAbCd12345")).toBeUndefined();

    ClientEnv.applyServerList(LIST, "d");
    expect(ClientEnv.gameVersion("cAbCd12345")).toBe(OTHER);
    expect(ClientEnv.gameVersion("dAbCd12345")).toBe(OWN);
    // Unknown letter, and legacy ids that carry no letter at all.
    expect(ClientEnv.gameVersion("zAbCd12345")).toBeUndefined();
    expect(ClientEnv.gameVersion("abcd1234")).toBeUndefined();
  });
});
