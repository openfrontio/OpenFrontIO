import { afterEach, describe, expect, test, vi } from "vitest";
import { GAME_ID_REGEX } from "../../src/core/Schemas";
import { ServerEnv } from "../../src/server/ServerEnv";

// A deployed server's identity, as deploy.sh writes it into the env file.
function stubIdentity(
  subdomain: string,
  domain: string,
  letter = "a",
  numWorkers = "4",
) {
  vi.stubEnv("INSTANCE_LETTER", letter);
  vi.stubEnv("NUM_WORKERS", numWorkers);
  vi.stubEnv("SUBDOMAIN", subdomain);
  vi.stubEnv("DOMAIN", domain);
}

describe("ServerEnv identity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("reads the letter and worker count deploy.sh wrote", () => {
    stubIdentity("green", "openfront.io", "d", "20");
    expect(ServerEnv.instanceLetter()).toBe("d");
    expect(ServerEnv.numWorkers()).toBe(20);
  });

  test("synthesizes a one-entry map naming this server", () => {
    stubIdentity("green", "openfront.io", "d", "20");
    expect(ServerEnv.cluster()).toEqual({
      d: { host: "green.openfront.io", numWorkers: 20 },
    });
  });

  test("names the bare DOMAIN in the map when SUBDOMAIN is empty", () => {
    stubIdentity("", "openfront.example", "c", "1");
    expect(ServerEnv.cluster()).toEqual({
      c: { host: "openfront.example", numWorkers: 1 },
    });
  });

  // GAME_HOST is the name deploy.sh settled on — for a machine-scoped fleet
  // member it is not derivable from SUBDOMAIN and GAME_DOMAIN — and the map
  // must carry that same name, or a page would pin itself to a host the
  // registry does not know.
  test("names GAME_HOST in the map when deploy.sh wrote one", () => {
    stubIdentity("blue", "openfront.dev", "f", "2");
    vi.stubEnv("GAME_DOMAIN", "server.openfront.dev");
    vi.stubEnv("GAME_HOST", "blue.nbg2.server.openfront.dev");
    expect(ServerEnv.cluster()).toEqual({
      f: { host: "blue.nbg2.server.openfront.dev", numWorkers: 2 },
    });
  });

  test.each(["ab", "A", "1", "-"])("refuses INSTANCE_LETTER %j", (letter) => {
    stubIdentity("blue", "openfront.io", letter);
    expect(() => ServerEnv.instanceLetter()).toThrow(/Invalid INSTANCE_LETTER/);
  });

  test.each(["0", "-1", "1.5", "two"])("refuses NUM_WORKERS %j", (n) => {
    stubIdentity("blue", "openfront.io", "a", n);
    expect(() => ServerEnv.numWorkers()).toThrow(/Invalid NUM_WORKERS/);
  });

  // The test process runs as GameEnv.Dev (GAME_ENV is read once at class
  // load), where a missing identity falls back to the local defaults. A
  // deployed server refuses to boot on the same input; deploy.sh guarantees
  // it never gets there (tests/DeployIdentity.test.ts).
  test("falls back to the local dev identity when unset", () => {
    vi.stubEnv("INSTANCE_LETTER", "");
    vi.stubEnv("NUM_WORKERS", "");
    vi.stubEnv("SUBDOMAIN", "");
    vi.stubEnv("DOMAIN", "localhost");
    expect(ServerEnv.cluster()).toEqual({
      a: { host: "localhost", numWorkers: 2 },
    });
  });
});

describe("ServerEnv game id minting", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("mints 10-char ids under the own instance letter", () => {
    stubIdentity("blue", "openfront.io");
    for (let i = 0; i < 20; i++) {
      const id = ServerEnv.generateGameId();
      expect(id).toHaveLength(10);
      expect(id[0]).toBe("a");
      expect(GAME_ID_REGEX.test(id)).toBe(true);
    }
  });

  test("generateGameIdForWorker hashes the full id to the worker", () => {
    stubIdentity("blue", "openfront.io");
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

  // With a separate game domain the deployment has two names: the page host
  // (<subdomain>.<DOMAIN>, the static Worker) and the game host, which is
  // what publicHost means — sockets and /api come straight here.
  test("uses GAME_DOMAIN when one is set", () => {
    vi.stubEnv("SUBDOMAIN", "main");
    vi.stubEnv("DOMAIN", "openfront.dev");
    vi.stubEnv("GAME_DOMAIN", "server.openfront.dev");
    expect(ServerEnv.publicHost()).toBe("main.server.openfront.dev");
    expect(ServerEnv.gameDomain()).toBe("server.openfront.dev");
  });

  test("falls back to DOMAIN when GAME_DOMAIN is unset", () => {
    vi.stubEnv("SUBDOMAIN", "main");
    vi.stubEnv("DOMAIN", "openfront.dev");
    expect(ServerEnv.publicHost()).toBe("main.openfront.dev");
    expect(ServerEnv.gameDomain()).toBeUndefined();
  });

  // deploy.sh resolves the game host from the cluster map and writes it
  // through as GAME_HOST. A machine-scoped entry — the machine in the
  // hostname so one colour can span boxes — is not derivable from SUBDOMAIN
  // and GAME_DOMAIN, so the written value wins over the derivation.
  test("prefers GAME_HOST when deploy.sh resolved one", () => {
    vi.stubEnv("SUBDOMAIN", "blue");
    vi.stubEnv("DOMAIN", "openfront.dev");
    vi.stubEnv("GAME_DOMAIN", "server.openfront.dev");
    vi.stubEnv("GAME_HOST", "blue.staging2.server.openfront.dev");
    expect(ServerEnv.publicHost()).toBe("blue.staging2.server.openfront.dev");
  });

  test("treats an empty GAME_HOST as unset", () => {
    vi.stubEnv("SUBDOMAIN", "main");
    vi.stubEnv("DOMAIN", "openfront.dev");
    vi.stubEnv("GAME_DOMAIN", "server.openfront.dev");
    vi.stubEnv("GAME_HOST", "");
    expect(ServerEnv.publicHost()).toBe("main.server.openfront.dev");
  });

  // An empty repo variable is how GitHub delivers "not set", and deploy.sh
  // writes GAME_DOMAIN= into the env file unconditionally, so empty must
  // read exactly like absent or every prod container would try to serve
  // itself on a bare subdomain.
  test("treats an empty GAME_DOMAIN as unset", () => {
    vi.stubEnv("SUBDOMAIN", "blue");
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("GAME_DOMAIN", "");
    expect(ServerEnv.publicHost()).toBe("blue.openfront.io");
    expect(ServerEnv.gameDomain()).toBeUndefined();
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
