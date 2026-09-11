import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  applyCheckinState,
  checkinBody,
  sendCheckin,
} from "../../src/server/ClusterCheckin";

// Multi-server v2, priority 3 (docs/MultiServer.md, "Server list v2"): every
// server tells the API who it is and what it runs, and the API replies with
// whether it should take new games. Until CLUSTER_STATE_SOURCE=api the reply
// is recorded but not obeyed, so a deploy without the API is unchanged.
const CLUSTER = JSON.stringify({
  a: { host: "blue.openfront.io", color: "blue", numWorkers: 4 },
  b: { host: "green.openfront.io", color: "green", numWorkers: 4 },
});

function fetchReturning(body: unknown, status = 200) {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe("checkinBody", () => {
  beforeEach(() => {
    vi.stubEnv("CLUSTER_JSON", CLUSTER);
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("SUBDOMAIN", "blue");
    vi.stubEnv("GIT_COMMIT", "bfd5563a11111111111111111111111111111111");
  });
  afterEach(() => vi.unstubAllEnvs());

  test("registers under the apex when the deployment sits behind one", () => {
    vi.stubEnv("SITE_HOST", "openfront.io");
    expect(checkinBody(7)).toEqual({
      site: "openfront.io",
      letter: "a",
      host: "blue.openfront.io",
      version: "bfd5563a11111111111111111111111111111111",
      numWorkers: 4,
      liveGames: 7,
    });
  });

  // Every deployed host that isn't behind the apex load balancer is its own
  // site. Mirrors (the openfront.dev apex serving nightly) are aliased in
  // the API, so nothing here reports them.
  test.each([
    {
      what: "a branch preview",
      domain: "openfront.dev",
      subdomain: "my-branch",
      numWorkers: 2,
    },
    { what: "beta", domain: "openfront.io", subdomain: "beta", numWorkers: 4 },
    {
      what: "nightly",
      domain: "openfront.dev",
      subdomain: "nightly",
      numWorkers: 3,
    },
  ])(
    "registers under its own host when standalone ($what)",
    ({ domain, subdomain, numWorkers }) => {
      const host = `${subdomain}.${domain}`;
      vi.stubEnv("SITE_HOST", "");
      vi.stubEnv("DOMAIN", domain);
      vi.stubEnv("SUBDOMAIN", subdomain);
      vi.stubEnv(
        "CLUSTER_JSON",
        JSON.stringify({ a: { host, color: "blue", numWorkers } }),
      );
      expect(checkinBody(0)).toMatchObject({
        site: host,
        host,
        letter: "a",
        numWorkers,
      });
    },
  );

  test("does not check in from local development (npm run dev, no SUBDOMAIN)", () => {
    vi.stubEnv("SITE_HOST", "");
    vi.stubEnv("SUBDOMAIN", "");
    vi.stubEnv("DOMAIN", "localhost");
    vi.stubEnv("GAME_ENV", "dev");
    expect(checkinBody(0)).toBeNull();
  });
});

describe("sendCheckin", () => {
  const body = {
    site: "openfront.io",
    letter: "a",
    host: "blue.openfront.io",
    version: "bfd5563a11111111111111111111111111111111",
    numWorkers: 4,
    liveGames: 7,
  };

  beforeEach(() => {
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("API_KEY", "secret");
  });
  afterEach(() => vi.unstubAllEnvs());

  test("posts the body to the API with the deploy key and returns the state", async () => {
    const fetchFn = fetchReturning({ state: "draining" });
    await expect(sendCheckin(body, fetchFn)).resolves.toBe("draining");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openfront.io/cluster/checkin");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "secret",
    );
    expect(JSON.parse(String(init.body))).toEqual(body);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test.each([
    ["a 404 (API without the registry yet)", fetchReturning({}, 404)],
    ["an unknown state", fetchReturning({ state: "fenced" })],
    [
      "a non-JSON body",
      vi.fn(
        async () => new Response("<html>", { status: 200 }),
      ) as unknown as typeof fetch,
    ],
    [
      "a network error",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    ],
  ])("returns null on %s", async (_name, fetchFn) => {
    await expect(sendCheckin(body, fetchFn)).resolves.toBeNull();
  });
});

describe("applyCheckinState", () => {
  test("obeys the API only when it is the configured state source", () => {
    const setActive = vi.fn();
    applyCheckinState("draining", "api", setActive);
    expect(setActive).toHaveBeenLastCalledWith(false);
    applyCheckinState("open", "api", setActive);
    expect(setActive).toHaveBeenLastCalledWith(true);
  });

  test("records but never applies the state under the apex source", () => {
    const setActive = vi.fn();
    applyCheckinState("draining", "apex", setActive);
    expect(setActive).not.toHaveBeenCalled();
  });

  test("a failed check-in never drains: null means no change", () => {
    const setActive = vi.fn();
    applyCheckinState(null, "api", setActive);
    expect(setActive).not.toHaveBeenCalled();
  });
});
