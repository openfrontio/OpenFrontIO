import { describe, expect, it } from "vitest";
import {
  commitsMatch,
  isCommitLike,
  pickOpenServer,
  ServerList,
  ServerListSchema,
  stripVersionPrefix,
  versionedPath,
  versionMatches,
} from "../../src/core/ServerList";

// The API-served server list (docs/MultiServer.md, "Server list v2"): every
// server says which commit it runs and whether it takes new games, and the
// client picks one running its own build.
const LIST: ServerList = {
  latest: "bfd5563a11111111111111111111111111111111",
  servers: {
    c: {
      host: "falk2-a.openfront.io",
      numWorkers: 16,
      version: "5ccc50a722222222222222222222222222222222",
      state: "draining",
    },
    d: {
      host: "falk2-b.openfront.io",
      numWorkers: 16,
      version: "bfd5563a11111111111111111111111111111111",
      state: "open",
    },
    e: {
      host: "nbg2-a.openfront.io",
      numWorkers: 8,
      version: "bfd5563a11111111111111111111111111111111",
      state: "open",
    },
  },
};

describe("ServerListSchema", () => {
  it("accepts the documented shape", () => {
    expect(ServerListSchema.safeParse(LIST).success).toBe(true);
  });

  it("accepts a list with no latest (e.g. a preview whose server expired)", () => {
    expect(ServerListSchema.safeParse({ servers: LIST.servers }).success).toBe(
      true,
    );
  });

  // latest and version are interpolated into /v/<x>/ by versionedPath, and
  // the loop guard can only compare commit-shaped values. A list naming
  // anything else is rejected whole, so the client keeps its own values
  // instead of navigating to a path nothing serves.
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
        servers: { d: { ...LIST.servers.d, state: "fenced" } },
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

describe("pickOpenServer", () => {
  it("picks only open servers running the client's version", () => {
    const picks = new Set<string | null>();
    for (let i = 0; i < 20; i++) {
      picks.add(pickOpenServer(LIST, "bfd5563a", Math.random));
    }
    expect(picks.has("c")).toBe(false);
    expect(picks.size).toBeGreaterThan(0);
    for (const p of picks) expect(["d", "e"]).toContain(p);
  });

  it("is uniform over the candidates for a given random draw", () => {
    expect(pickOpenServer(LIST, "bfd5563a", () => 0)).toBe("d");
    expect(pickOpenServer(LIST, "bfd5563a", () => 0.99)).toBe("e");
  });

  it("returns null when no open server runs the client's version", () => {
    expect(pickOpenServer(LIST, "5ccc50a7", () => 0)).toBeNull();
    expect(pickOpenServer({ servers: {} }, "bfd5563a", () => 0)).toBeNull();
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
    // The only loop guard: a /v/<latest>/ page that still finds no open
    // server for itself must fall through to today's behaviour, never
    // navigate to itself again.
    expect(versionedPath("bfd5563a", "/v/bfd5563a/", "")).toBeNull();
    expect(versionedPath(LIST.latest!, "/v/bfd5563a/game/x", "")).toBeNull();
  });
});
