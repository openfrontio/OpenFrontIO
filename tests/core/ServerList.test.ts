import { describe, expect, it } from "vitest";
import {
  commitsMatch,
  isCommitLike,
  ownLetterIn,
  pickServerForBuild,
  ServerList,
  ServerListSchema,
  servesBuild,
  shortCommit,
  stripVersionPrefix,
  versionedPath,
  versionedPathForGame,
  versionMatches,
} from "../../src/core/ServerList";

const OWN = "bfd5563a11111111111111111111111111111111";
const OLD = "5ccc50a722222222222222222222222222222222";

// The API-served server list (docs/MultiServer.md, "Server list v2"): every
// server says which commit it runs and what it takes, and the client picks
// one running its own build — open first, a draining one on its build
// otherwise, never a fenced one.
const LIST: ServerList = {
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
    e: {
      host: "nbg2-a.openfront.io",
      numWorkers: 8,
      version: OWN,
      state: "open",
    },
    f: {
      host: "nbg2-b.openfront.io",
      numWorkers: 8,
      version: OWN,
      state: "fenced",
    },
  },
};

/** A one-server list, for the cases a state alone has to decide. */
function only(
  state: "open" | "draining" | "fenced",
  version = OWN,
): ServerList {
  return {
    latest: OWN,
    servers: {
      c: { host: "falk2-a.openfront.io", numWorkers: 16, version, state },
    },
  };
}

describe("ServerListSchema", () => {
  it("accepts the documented shape", () => {
    expect(ServerListSchema.safeParse(LIST).success).toBe(true);
  });

  it("accepts a list with no latest (e.g. a preview whose server expired)", () => {
    expect(ServerListSchema.safeParse({ servers: LIST.servers }).success).toBe(
      true,
    );
  });

  it("accepts all three server states", () => {
    for (const state of ["open", "draining", "fenced"]) {
      expect(
        ServerListSchema.safeParse({
          servers: { d: { ...LIST.servers.d, state } },
        }).success,
      ).toBe(true);
    }
  });

  // latest and version decide which server a build may use, and (for a
  // pinned game page) go into `/v/<commit>/`. Both compares only work on
  // commit-shaped values, so a list naming anything else is rejected whole
  // and the client keeps its own values.
  it("rejects a latest or a version that is not commit-shaped", () => {
    for (const latest of ["", "latest", "DEV", "../../evil", "deadbee"]) {
      expect(ServerListSchema.safeParse({ ...LIST, latest }).success).toBe(
        isCommitLike(latest),
      );
    }
    expect(
      ServerListSchema.safeParse({
        servers: { d: { ...LIST.servers.d, version: "DEV" } },
      }).success,
    ).toBe(false);
    expect(
      ServerListSchema.safeParse({
        servers: { d: { ...LIST.servers.d, version: "" } },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown state and a non-letter key", () => {
    expect(
      ServerListSchema.safeParse({
        servers: { d: { ...LIST.servers.d, state: "closed" } },
      }).success,
    ).toBe(false);
    expect(
      ServerListSchema.safeParse({
        servers: { D: LIST.servers.d },
      }).success,
    ).toBe(false);
  });
});

describe("commitsMatch / versionMatches", () => {
  it("matches a short commit against its full sha, case-insensitively", () => {
    expect(commitsMatch("bfd5563a", LIST.latest!)).toBe(true);
    expect(commitsMatch(LIST.latest!.toUpperCase(), "bfd5563a")).toBe(true);
  });

  it("does not match different commits or too-short prefixes", () => {
    expect(commitsMatch("5ccc50a7", LIST.latest!)).toBe(false);
    expect(commitsMatch("bfd55", LIST.latest!)).toBe(false);
  });

  it("treats non-commit build labels as matching any version", () => {
    // The dev server runs as "DEV"; an old desktop shell injects "desktop".
    // Neither names a build, so they must not filter every server out.
    expect(versionMatches("DEV", LIST.servers.d.version)).toBe(true);
    expect(versionMatches("desktop", LIST.servers.d.version)).toBe(true);
    expect(versionMatches("5ccc50a7", LIST.servers.d.version)).toBe(false);
  });
});

describe("pickServerForBuild", () => {
  it("picks only open servers running the client's version", () => {
    // c runs another build, f is fenced: neither is ever a candidate.
    const picks = new Set<string | null>();
    for (let i = 0; i < 20; i++) {
      picks.add(
        pickServerForBuild(LIST, "bfd5563a", (n) =>
          Math.floor(Math.random() * n),
        ),
      );
    }
    expect(picks.has("c")).toBe(false);
    expect(picks.has("f")).toBe(false);
    expect(picks.size).toBeGreaterThan(0);
    for (const p of picks) expect(["d", "e"]).toContain(p);
  });

  it("asks the chooser for an index into the candidates", () => {
    const seen: number[] = [];
    expect(
      pickServerForBuild(LIST, "bfd5563a", (n) => {
        seen.push(n);
        return 0;
      }),
    ).toBe("d");
    expect(seen).toEqual([2]);
    expect(pickServerForBuild(LIST, "bfd5563a", () => 1)).toBe("e");
  });

  // src/core takes no floating-point math, so the chooser hands back an
  // integer. A caller that miscounts must still land on a server.
  it("clamps an index outside the candidate range", () => {
    expect(pickServerForBuild(LIST, "bfd5563a", () => 99)).toBe("e");
    expect(pickServerForBuild(LIST, "bfd5563a", () => -1)).toBe("d");
    expect(pickServerForBuild(LIST, "bfd5563a", () => 1.5)).toBe("d");
  });

  // Today's rollover feel: a player on build X keeps playing on X's server
  // after Y ships, until they refresh. Their build's server is draining by
  // then, and it is still the right one to send them to.
  it("falls back to a draining server on the client's own build", () => {
    expect(pickServerForBuild(LIST, "5ccc50a7", () => 0)).toBe("c");
    expect(pickServerForBuild(only("draining"), OWN, () => 0)).toBe("c");
  });

  it("prefers an open server over a draining one on the same build", () => {
    const list: ServerList = {
      latest: OWN,
      servers: {
        c: { host: "a.io", numWorkers: 1, version: OWN, state: "draining" },
        d: { host: "b.io", numWorkers: 1, version: OWN, state: "open" },
      },
    };
    for (let i = 0; i < 10; i++) {
      expect(
        pickServerForBuild(list, OWN, (n) => Math.floor(Math.random() * n)),
      ).toBe("d");
    }
  });

  // Fenced is how a server is taken out of rotation while its games finish:
  // it takes nothing new, not even from the build it runs.
  it("never picks a fenced server, whatever else is on offer", () => {
    expect(pickServerForBuild(only("fenced"), OWN, () => 0)).toBeNull();
    expect(pickServerForBuild(only("fenced", OLD), OLD, () => 0)).toBeNull();
    expect(pickServerForBuild(LIST, "9999999", () => 0)).toBeNull();
    expect(pickServerForBuild({ servers: {} }, OWN, () => 0)).toBeNull();
  });
});

describe("servesBuild", () => {
  // The sticky pick: a page keeps the server it picked while that server
  // can still take its games, so the lobby list and the games created from
  // it land together. A flip to draining does not move it — that server
  // still runs this build.
  it("holds a letter while it is open or draining on this build", () => {
    expect(servesBuild(LIST, "d", OWN)).toBe(true);
    expect(servesBuild(only("draining"), "c", OWN)).toBe(true);
  });

  it("drops a letter that is fenced, on another build, or gone", () => {
    expect(servesBuild(LIST, "f", OWN)).toBe(false);
    expect(servesBuild(LIST, "c", OWN)).toBe(false);
    expect(servesBuild(LIST, "z", OWN)).toBe(false);
  });
});

// The lookup half of "a server-rendered page prefers its own server": which
// letter, if any, the list carries the page's own server under. Whether that
// server may be picked is servesBuild's question, asked by the client.
describe("ownLetterIn", () => {
  it("matches the page's own host against the entries", () => {
    expect(ownLetterIn(LIST, "nbg2-a.openfront.io", undefined)).toBe("e");
    // Hostnames are case-insensitive, and the two spellings arrive from
    // different places (a server's injected value and the registry's).
    expect(ownLetterIn(LIST, "NBG2-A.openfront.io", undefined)).toBe("e");
  });

  it("matches by letter when the page names no host of its own", () => {
    // A web page a game server rendered: the cluster map and its own letter
    // are all that name its server.
    expect(ownLetterIn(LIST, undefined, "d")).toBe("d");
    expect(ownLetterIn(LIST, "", "d")).toBe("d");
  });

  it("lets the host win when host and letter disagree", () => {
    // The host is what the page actually talks to; the letter comes from the
    // cluster map baked into the page, which the registry can have moved on
    // from.
    expect(ownLetterIn(LIST, "nbg2-a.openfront.io", "d")).toBe("e");
    // And a host the list does not carry answers null rather than falling
    // through to the letter, whose entry names some OTHER host.
    expect(ownLetterIn(LIST, "blue.openfront.io", "d")).toBeNull();
  });

  it("is null when the list carries neither", () => {
    expect(ownLetterIn(LIST, "blue.openfront.io", undefined)).toBeNull();
    expect(ownLetterIn(LIST, undefined, "z")).toBeNull();
    expect(ownLetterIn(LIST, undefined, undefined)).toBeNull();
    expect(
      ownLetterIn({ servers: {} }, "falk2-b.openfront.io", "d"),
    ).toBeNull();
  });
});

describe("stripVersionPrefix", () => {
  it("removes a /v/<commit>/ prefix and reports the commit", () => {
    expect(stripVersionPrefix("/v/bfd5563a/w3/game/dAbCd12345")).toEqual({
      commit: "bfd5563a",
      path: "/w3/game/dAbCd12345",
    });
    expect(stripVersionPrefix("/v/bfd5563a")).toEqual({
      commit: "bfd5563a",
      path: "/",
    });
  });

  it("leaves an unversioned path alone", () => {
    expect(stripVersionPrefix("/w3/game/dAbCd12345")).toEqual({
      commit: null,
      path: "/w3/game/dAbCd12345",
    });
    expect(stripVersionPrefix("/")).toEqual({ commit: null, path: "/" });
  });
});

describe("versionedPath", () => {
  it("prefixes the current path with the target version, dropping the worker prefix", () => {
    expect(versionedPath("bfd5563", "/w3/game/dAbCd12345", "?lobby")).toBe(
      "/v/bfd5563/game/dAbCd12345?lobby",
    );
    expect(versionedPath("bfd5563", "/", "")).toBe("/v/bfd5563/");
  });

  it("swaps an existing version prefix for the target", () => {
    expect(versionedPath("bfd5563", "/v/5ccc50a7/game/dAbCd12345", "")).toBe(
      "/v/bfd5563/game/dAbCd12345",
    );
  });

  // The bucket layout is `sites/<site>/v/<short7>/index.html` and the static
  // Worker keys on the same 7 characters, but callers hand us whatever the
  // server list carries -- which is the full 40-char GIT_COMMIT.
  it("emits the 7-character short form of a full sha", () => {
    expect(versionedPath(OWN, "/game/dAbCd12345", "")).toBe(
      "/v/bfd5563/game/dAbCd12345",
    );
    expect(versionedPath(OWN.toUpperCase(), "/", "")).toBe("/v/bfd5563/");
  });

  it("passes a short commit through unchanged", () => {
    expect(versionedPath("5ccc50a", "/game/dAbCd12345", "")).toBe(
      "/v/5ccc50a/game/dAbCd12345",
    );
  });

  it("returns null when the page is already under the target version", () => {
    // The one loop guard every caller that pins a page to a version shares:
    // a page already under /v/<commit>/ must never be navigated to itself.
    expect(versionedPath("bfd5563a", "/v/bfd5563a/", "")).toBeNull();
    expect(versionedPath(LIST.latest!, "/v/bfd5563a/game/x", "")).toBeNull();
    // And still when the page's prefix is the short form of the full sha
    // the caller passes -- which is now the only form this emits.
    expect(versionedPath(OWN, "/v/bfd5563/game/x", "")).toBeNull();
  });
});

describe("shortCommit", () => {
  it("narrows a sha to the 7 lowercase characters URLs use", () => {
    expect(shortCommit(OWN)).toBe("bfd5563");
    expect(shortCommit(OWN.toUpperCase())).toBe("bfd5563");
    expect(shortCommit("5ccc50a")).toBe("5ccc50a");
  });

  it("leaves a value that names no commit alone", () => {
    // "DEV" and "desktop" would truncate into something meaningless, and
    // commitsMatch only ever matches them against themselves.
    expect(shortCommit("DEV")).toBe("DEV");
    expect(shortCommit("desktop")).toBe("desktop");
  });
});

// The path a version redirect navigates to is decided by the GAME, not by
// the address bar: checkActiveLobby also runs from the homepage (a typed or
// pasted code, a click in the lobby list) and from a page showing a
// different game.
describe("versionedPathForGame", () => {
  const OTHER = "5ccc50a722222222222222222222222222222222";
  const SHORT_OTHER = "5ccc50a";
  const ID = "cAbCd12345";
  // What ClientEnv.gamePath(ID) hands over: version-free, worker-prefixed.
  const GAME_PATH = `/w3/game/${ID}`;

  it("returns null when the game's server runs this build", () => {
    // Prefix-tolerant, like every other commit compare: the list carries the
    // full sha while the page's own value may be short.
    expect(
      versionedPathForGame(OWN, OWN, ID, GAME_PATH, `/game/${ID}`, ""),
    ).toBeNull();
    expect(
      versionedPathForGame("bfd5563a", OWN, ID, GAME_PATH, `/game/${ID}`, ""),
    ).toBeNull();
  });

  it("keeps the current path, and its search, when it names this game", () => {
    expect(
      versionedPathForGame(
        OWN,
        OTHER,
        ID,
        GAME_PATH,
        `/w3/game/${ID}`,
        "?lobby",
      ),
    ).toBe(`/v/${SHORT_OTHER}/game/${ID}?lobby`);
  });

  // The homepage case: checkActiveLobby is reached from enterLobbyFromInput
  // and joinHostedLobby, where the pathname is "/". Versioning THAT would
  // send the player to the other build's home page and silently drop the
  // code they just typed.
  it("builds the game's own path from the homepage", () => {
    expect(versionedPathForGame(OWN, OTHER, ID, GAME_PATH, "/", "")).toBe(
      `/v/${SHORT_OTHER}/game/${ID}`,
    );
  });

  // Spectate from the homepage lives only in memory until this navigation,
  // and Main.handleUrl reads it from the search: the rebuilt URL must carry
  // it, or the spectator lands as a player and takes a seat.
  it("carries a spectate intent onto the rebuilt path", () => {
    expect(versionedPathForGame(OWN, OTHER, ID, GAME_PATH, "/", "", true)).toBe(
      `/v/${SHORT_OTHER}/game/${ID}?spectate`,
    );
    // The page's own search already says it, or deliberately does not.
    expect(
      versionedPathForGame(
        OWN,
        OTHER,
        ID,
        GAME_PATH,
        `/w3/game/${ID}`,
        "?spectate",
        false,
      ),
    ).toBe(`/v/${SHORT_OTHER}/game/${ID}?spectate`);
    expect(
      versionedPathForGame(
        OWN,
        OTHER,
        ID,
        GAME_PATH,
        `/w3/game/${ID}`,
        "",
        true,
      ),
    ).toBe(`/v/${SHORT_OTHER}/game/${ID}`);
  });

  // The sharper case: versioning the ambient path would route the player
  // into a DIFFERENT game than the one they asked to join.
  it("ignores another game's path, and its search", () => {
    expect(
      versionedPathForGame(
        OWN,
        OTHER,
        ID,
        GAME_PATH,
        "/game/dAbCd12345",
        "?spectate",
      ),
    ).toBe(`/v/${SHORT_OTHER}/game/${ID}`);
  });

  it("returns null when the page already lives under the game's version", () => {
    // The loop guard: /v/<x>/ is already being served something, and if it
    // is not x's bundle there is nothing this navigation can fix. Falling
    // through hands the mismatch to join-time version_mismatch. It holds
    // wherever the page is, not just on the game's own path -- otherwise
    // rebuilding the path would step straight over it.
    expect(
      versionedPathForGame(
        OWN,
        OTHER,
        ID,
        GAME_PATH,
        `/v/${SHORT_OTHER}/game/${ID}`,
        "",
      ),
    ).toBeNull();
    expect(
      versionedPathForGame(OWN, OTHER, ID, GAME_PATH, `/v/${SHORT_OTHER}/`, ""),
    ).toBeNull();
  });

  it("returns null when this build names no commit", () => {
    // "DEV" from the dev server, "desktop" from an old shell: they match any
    // version, so they are never sent off their own server.
    expect(
      versionedPathForGame("DEV", OTHER, ID, GAME_PATH, `/game/${ID}`, ""),
    ).toBeNull();
  });

  it("returns null when the game's version is unknown", () => {
    // No list loaded, or a letter the list does not carry.
    expect(
      versionedPathForGame(OWN, undefined, ID, GAME_PATH, `/game/${ID}`, ""),
    ).toBeNull();
  });
});
