import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  applyCheckinState,
  checkinBody,
  isRefusal,
  sendCheckin,
} from "../../src/server/ClusterCheckin";

// Multi-server v2, priority 3 (docs/MultiServer.md, "Server list v2"): every
// server tells the API who it is and what it runs, and the API replies with
// whether it should take new games.

function fetchReturning(body: unknown, status = 200) {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe("checkinBody", () => {
  beforeEach(() => {
    vi.stubEnv("GAME_ENV", "prod");
    vi.stubEnv("INSTANCE_LETTER", "a");
    vi.stubEnv("NUM_WORKERS", "4");
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("SUBDOMAIN", "blue");
    vi.stubEnv("GIT_COMMIT", "bfd5563a11111111111111111111111111111111");
    // Explicit rather than inherited: whether this repo's own CI box happens
    // to export MACHINE must not decide whether the body carries the key.
    vi.stubEnv("MACHINE", "");
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

  // A dev deployment with GAME_DOMAIN set has the same two-hostname shape as
  // prod without a load balancer: the page lives on <subdomain>.<DOMAIN>,
  // which the static Worker serves, and this server answers on
  // <subdomain>.<GAME_DOMAIN>. It must register the page host as its `site`
  // — that is what the client's server list is keyed by — and its game host
  // as `host`, or players would be pointed at the Worker for sockets.
  test("separates the page host from the game host when GAME_DOMAIN is set", () => {
    vi.stubEnv("DOMAIN", "openfront.dev");
    vi.stubEnv("GAME_DOMAIN", "server.openfront.dev");
    vi.stubEnv("SUBDOMAIN", "main");
    vi.stubEnv("SITE_HOST", "main.openfront.dev");
    vi.stubEnv("NUM_WORKERS", "2");
    expect(checkinBody(3)).toEqual({
      site: "main.openfront.dev",
      letter: "a",
      host: "main.server.openfront.dev",
      version: "bfd5563a11111111111111111111111111111111",
      numWorkers: 2,
      liveGames: 3,
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
      vi.stubEnv("NUM_WORKERS", String(numWorkers));
      expect(checkinBody(0)).toMatchObject({
        site: host,
        host,
        letter: "a",
        numWorkers,
      });
    },
  );

  // The machine the container runs on (OPE-455). The registry holds a site to
  // one OPEN server per machine, which it can only do if the server says which
  // box it is on: blue and green routinely share one, and flipping to a colour
  // on the same machine buys no redundancy.
  test("reports the machine it runs on when deploy.sh supplied one", () => {
    vi.stubEnv("SITE_HOST", "openfront.io");
    vi.stubEnv("MACHINE", "falk2");
    expect(checkinBody(7)).toMatchObject({ machine: "falk2" });
  });

  // Omitted, not null and not empty: the registry's CheckInSchema on infra
  // main does not know the field yet, and an absent key is the one shape every
  // version of that schema accepts.
  test.each([
    ["MACHINE is unset", ""],
    ["MACHINE is whitespace", "   "],
    ["MACHINE is not a hostname label", "falk2.openfront.io"],
    ["MACHINE carries a shell fragment", "falk2; rm -rf /"],
  ])("omits the key entirely when %s", (_what, value) => {
    vi.stubEnv("SITE_HOST", "openfront.io");
    vi.stubEnv("MACHINE", value);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = checkinBody(7);
    expect(body).not.toBeNull();
    expect(body && "machine" in body).toBe(false);
    warn.mockRestore();
  });

  // A malformed value costs the field, never the check-in: every other key is
  // still exactly what it would have been.
  test("a malformed machine leaves the rest of the body untouched", () => {
    vi.stubEnv("SITE_HOST", "openfront.io");
    vi.stubEnv("MACHINE", "falk 2");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(checkinBody(7)).toEqual({
      site: "openfront.io",
      letter: "a",
      host: "blue.openfront.io",
      version: "bfd5563a11111111111111111111111111111111",
      numWorkers: 4,
      liveGames: 7,
    });
    // Once, not once per beat: check-in runs every 10s forever, so a value
    // nobody is going to fix would otherwise fill the logs.
    checkinBody(7);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

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

  test("parses a fenced reply instead of discarding it as unknown", async () => {
    await expect(
      sendCheckin(body, fetchReturning({ state: "fenced" })),
    ).resolves.toBe("fenced");
  });

  test.each([
    ["a 404 (API without the registry yet)", fetchReturning({}, 404)],
    ["a 5xx", fetchReturning({}, 503)],
    ["a state outside the vocabulary", fetchReturning({ state: "retired" })],
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

  // The letter belongs to another host, so the API routes its games there.
  test("reports a 409 as a refusal carrying the API's reason", async () => {
    const result = await sendCheckin(
      body,
      fetchReturning(
        { reason: "letter_bound_to_other_host", host: "green.openfront.io" },
        409,
      ),
    );
    expect(isRefusal(result)).toBe(true);
    expect(result).toEqual({
      refused: "letter_bound_to_other_host (host: green.openfront.io)",
    });
  });

  test("a 409 with an unreadable body is still a refusal", async () => {
    const fetchFn = vi.fn(
      async () => new Response("<html>", { status: 409 }),
    ) as unknown as typeof fetch;
    await expect(sendCheckin(body, fetchFn)).resolves.toEqual({
      refused: "no reason given",
    });
  });
});

describe("applyCheckinState", () => {
  test("only open is active", () => {
    const setActive = vi.fn();
    applyCheckinState("draining", setActive);
    expect(setActive).toHaveBeenLastCalledWith(false);
    applyCheckinState("open", setActive);
    expect(setActive).toHaveBeenLastCalledWith(true);
  });

  test("a refused server takes no new games", () => {
    const setActive = vi.fn();
    applyCheckinState({ refused: "letter_bound_to_other_host" }, setActive);
    expect(setActive).toHaveBeenLastCalledWith(false);
  });

  // A fence is an operator holding this server out of rotation. It has to
  // stop new games like a drain does; only "open" is active.
  test("a fenced server takes no new games", () => {
    const setActive = vi.fn();
    applyCheckinState("fenced", setActive);
    expect(setActive).toHaveBeenLastCalledWith(false);
  });

  test("a failed check-in never drains: null means no change", () => {
    const setActive = vi.fn();
    applyCheckinState(null, setActive);
    expect(setActive).not.toHaveBeenCalled();
  });
});
