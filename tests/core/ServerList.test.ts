import { describe, expect, it } from "vitest";
import {
  commitsMatch,
  isCommitLike,
  pickServerForBuild,
  ServerList,
  ServerListSchema,
  servesBuild,
  stripVersionPrefix,
  versionedPath,
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
    expect(versionedPath("bfd5563a", "/w3/game/dAbCd12345", "?lobby")).toBe(
      "/v/bfd5563a/game/dAbCd12345?lobby",
    );
    expect(versionedPath("bfd5563a", "/", "")).toBe("/v/bfd5563a/");
  });

  it("swaps an existing version prefix for the target", () => {
    expect(versionedPath("bfd5563a", "/v/5ccc50a7/game/dAbCd12345", "")).toBe(
      "/v/bfd5563a/game/dAbCd12345",
    );
  });

  it("returns null when the page is already under the target version", () => {
    // The one loop guard every caller that pins a page to a version shares:
    // a page already under /v/<commit>/ must never be navigated to itself.
    expect(versionedPath("bfd5563a", "/v/bfd5563a/", "")).toBeNull();
    expect(versionedPath(LIST.latest!, "/v/bfd5563a/game/x", "")).toBeNull();
  });
});
