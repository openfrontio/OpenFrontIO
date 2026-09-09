import { afterEach, describe, expect, test, vi } from "vitest";
import { GAME_ID_REGEX } from "../../src/core/Schemas";
import { ServerEnv } from "../../src/server/ServerEnv";

// A two-deployment prod-shaped map plus a bare-domain dev box.
const CLUSTER = JSON.stringify({
  a: { host: "blue.openfront.io", color: "blue", numWorkers: 4 },
  b: { host: "green.openfront.io", color: "green", numWorkers: 2 },
  c: { host: "openfront.example", color: "blue", numWorkers: 1 },
});

function stubCluster(subdomain: string, domain: string, json = CLUSTER) {
  vi.stubEnv("CLUSTER_JSON", json);
  vi.stubEnv("SUBDOMAIN", subdomain);
  vi.stubEnv("DOMAIN", domain);
}

describe("ServerEnv.cluster", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("parses a valid map", () => {
    vi.stubEnv("CLUSTER_JSON", CLUSTER);
    expect(ServerEnv.cluster().a.numWorkers).toBe(4);
    expect(ServerEnv.cluster().b.color).toBe("green");
  });

  test("falls back to the single-entry localhost map in dev when unset", () => {
    vi.stubEnv("CLUSTER_JSON", "");
    expect(ServerEnv.cluster()).toEqual(
      JSON.parse(ServerEnv.DEV_DEFAULT_CLUSTER_JSON),
    );
  });

  test("throws on malformed JSON", () => {
    vi.stubEnv("CLUSTER_JSON", "{not json");
    expect(() => ServerEnv.cluster()).toThrow(/not valid JSON/);
  });

  test("throws on duplicate hosts", () => {
    vi.stubEnv(
      "CLUSTER_JSON",
      JSON.stringify({
        a: { host: "same.io", color: "blue", numWorkers: 1 },
        b: { host: "same.io", color: "green", numWorkers: 1 },
      }),
    );
    expect(() => ServerEnv.cluster()).toThrow(/Invalid CLUSTER_JSON/);
  });

  test("throws on a bad color or letter", () => {
    vi.stubEnv(
      "CLUSTER_JSON",
      JSON.stringify({
        a: { host: "x.io", color: "purple", numWorkers: 1 },
      }),
    );
    expect(() => ServerEnv.cluster()).toThrow(/Invalid CLUSTER_JSON/);

    vi.stubEnv(
      "CLUSTER_JSON",
      JSON.stringify({
        ab: { host: "x.io", color: "blue", numWorkers: 1 },
      }),
    );
    expect(() => ServerEnv.cluster()).toThrow(/Invalid CLUSTER_JSON/);
  });
});

describe("ServerEnv.clusterSelf", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("resolves by SUBDOMAIN.DOMAIN", () => {
    stubCluster("green", "openfront.io");
    expect(ServerEnv.instanceLetter()).toBe("b");
    expect(ServerEnv.numWorkers()).toBe(2);
    expect(ServerEnv.color()).toBe("green");
  });

  test("resolves by bare DOMAIN when SUBDOMAIN is empty", () => {
    stubCluster("", "openfront.example");
    expect(ServerEnv.instanceLetter()).toBe("c");
    expect(ServerEnv.numWorkers()).toBe(1);
  });

  test("throws when the host has no entry", () => {
    stubCluster("red", "openfront.io");
    expect(() => ServerEnv.numWorkers()).toThrow(/no entry in CLUSTER_JSON/);
  });
});

describe("ServerEnv game id minting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("mints 10-char ids under the own instance letter", () => {
    stubCluster("blue", "openfront.io");
    for (let i = 0; i < 20; i++) {
      const id = ServerEnv.generateGameId();
      expect(id).toHaveLength(10);
      expect(id[0]).toBe("a");
      expect(GAME_ID_REGEX.test(id)).toBe(true);
    }
  });

  test("generateGameIdForWorker hashes the full id to the worker", () => {
    stubCluster("blue", "openfront.io");
    for (const workerId of [0, 1, 2, 3]) {
      const id = ServerEnv.generateGameIdForWorker(workerId);
      expect(id).not.toBeNull();
      expect(id).toHaveLength(10);
      expect(id![0]).toBe("a");
      expect(ServerEnv.workerIndex(id!)).toBe(workerId);
    }
  });
});

describe("ServerEnv.turnstileSiteKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns value when set", () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    expect(ServerEnv.turnstileSiteKey()).toBe("site-key");
  });

  test("throws when unset", () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    expect(() => ServerEnv.turnstileSiteKey()).toThrow(
      /TURNSTILE_SITE_KEY not set/,
    );
  });
});

describe("ServerEnv.jwtAudience", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns DOMAIN when set", () => {
    vi.stubEnv("DOMAIN", "openfront.io");
    expect(ServerEnv.jwtAudience()).toBe("openfront.io");
  });

  test("throws when DOMAIN unset", () => {
    vi.stubEnv("DOMAIN", "");
    expect(() => ServerEnv.jwtAudience()).toThrow(/DOMAIN not set/);
  });
});

describe("ServerEnv.jwtIssuer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("maps 'localhost' to http://localhost:8787", () => {
    vi.stubEnv("DOMAIN", "localhost");
    expect(ServerEnv.jwtIssuer()).toBe("http://localhost:8787");
  });

  test("derives api.<audience> for non-localhost", () => {
    vi.stubEnv("DOMAIN", "openfront.io");
    expect(ServerEnv.jwtIssuer()).toBe("https://api.openfront.io");
  });
});

describe("ServerEnv.allowedFlares", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns undefined when unset", () => {
    vi.stubEnv("ALLOWED_FLARES", "");
    expect(ServerEnv.allowedFlares()).toBeUndefined();
  });

  test("parses a single value", () => {
    vi.stubEnv("ALLOWED_FLARES", "admin");
    expect(ServerEnv.allowedFlares()).toEqual(["admin"]);
  });

  test("parses CSV", () => {
    vi.stubEnv("ALLOWED_FLARES", "admin,beta,internal");
    expect(ServerEnv.allowedFlares()).toEqual(["admin", "beta", "internal"]);
  });

  test("trims whitespace and drops empties", () => {
    vi.stubEnv("ALLOWED_FLARES", " admin , , beta ");
    expect(ServerEnv.allowedFlares()).toEqual(["admin", "beta"]);
  });
});

describe("ServerEnv.publicHost", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("is the deployment's own host, subdomain.domain", () => {
    vi.stubEnv("SUBDOMAIN", "blue");
    vi.stubEnv("DOMAIN", "openfront.io");
    expect(ServerEnv.publicHost()).toBe("blue.openfront.io");
  });

  test("is undefined without a subdomain (dev)", () => {
    vi.stubEnv("SUBDOMAIN", "");
    vi.stubEnv("DOMAIN", "localhost");
    expect(ServerEnv.publicHost()).toBeUndefined();
  });
});

describe("ServerEnv.siteHost", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns the configured load balancer host", () => {
    vi.stubEnv("SITE_HOST", "openfront.io");
    expect(ServerEnv.siteHost()).toBe("openfront.io");
  });

  test("is undefined when unset or empty (standalone deployment)", () => {
    vi.stubEnv("SITE_HOST", "");
    expect(ServerEnv.siteHost()).toBeUndefined();
  });
});
