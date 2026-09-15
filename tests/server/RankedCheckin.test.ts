import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RANKED_PAUSED_LOG,
  RANKED_RESUMED_LOG,
  RankedCheckinGate,
  rankedCheckinPass,
  type RankedCheckinDeps,
} from "../../src/server/RankedCheckin";
import { mockLogger } from "../util/GameServerHarness";

// OPE-469: a draining deployment kept offering ranked matches, so players on
// the new build were matched onto the old one, bounced on version_mismatch,
// and the match cancelled short-handed. The ranked check-in must follow the
// same active flag the master already pushes to its workers.

const CLUSTER = JSON.stringify({
  a: { host: "blue.openfront.io", color: "blue", numWorkers: 4 },
  b: { host: "green.openfront.io", color: "green", numWorkers: 4 },
});

function okFetch(body: unknown = {}) {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status: 200 }),
  ) as unknown as typeof fetch;
}

function makeDeps(
  isActive: () => boolean,
  fetchFn: typeof fetch,
): RankedCheckinDeps & { log: ReturnType<typeof mockLogger> } {
  const log = mockLogger();
  return {
    gm: {
      activeClients: vi.fn().mockReturnValue(3),
      createGame: vi.fn().mockReturnValue({}),
    } as any,
    playlist: {
      get1v1Config: vi.fn().mockReturnValue({ gameMap: "Europe" }),
      get2v2Config: vi.fn().mockReturnValue({ gameMap: "Europe" }),
    } as any,
    workerId: 0,
    log,
    isActive,
    fetchFn,
  };
}

describe("RankedCheckinGate", () => {
  it("checks in while the deployment is active", () => {
    const log = mockLogger();
    const gate = new RankedCheckinGate(() => true, log);
    expect(gate.shouldCheckIn()).toBe(true);
    expect(gate.shouldCheckIn()).toBe(true);
    // Staying active is the steady state, so it says nothing.
    expect(log.info).not.toHaveBeenCalled();
  });

  it("defaults to active, so a worker that never hears from its master works", () => {
    // WorkerLobbyService.deploymentActive is true until the first broadcast;
    // the gate must not second-guess that with its own seed.
    const gate = new RankedCheckinGate(() => true, mockLogger());
    expect(gate.shouldCheckIn()).toBe(true);
  });

  it("stops checking in once the deployment drains", () => {
    let active = true;
    const gate = new RankedCheckinGate(() => active, mockLogger());
    expect(gate.shouldCheckIn()).toBe(true);
    active = false;
    expect(gate.shouldCheckIn()).toBe(false);
  });

  it("logs once per transition, not once per pass", () => {
    let active = true;
    const log = mockLogger();
    const gate = new RankedCheckinGate(() => active, log);

    gate.shouldCheckIn();
    active = false;
    gate.shouldCheckIn();
    gate.shouldCheckIn();
    gate.shouldCheckIn();
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenLastCalledWith(RANKED_PAUSED_LOG);

    active = true;
    gate.shouldCheckIn();
    gate.shouldCheckIn();
    expect(log.info).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenLastCalledWith(RANKED_RESUMED_LOG);
  });

  it("shares one gate across both modes' loops, so a drain is announced once", () => {
    let active = true;
    const log = mockLogger();
    const gate = new RankedCheckinGate(() => active, log);
    gate.shouldCheckIn();
    active = false;
    // The 1v1 loop notices first; the 2v2 loop must not repeat it.
    gate.shouldCheckIn();
    gate.shouldCheckIn();
    expect(log.info).toHaveBeenCalledTimes(1);
  });
});

describe("rankedCheckinPass", () => {
  beforeEach(() => {
    vi.stubEnv("CLUSTER_JSON", CLUSTER);
    vi.stubEnv("DOMAIN", "openfront.io");
    vi.stubEnv("SUBDOMAIN", "blue");
    vi.stubEnv("API_KEY", "test-key");
    vi.stubEnv("INSTANCE_ID", "abcd1234");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("checks in when active", async () => {
    const fetchFn = okFetch({ assignment: null });
    const deps = makeDeps(() => true, fetchFn);
    const gate = new RankedCheckinGate(deps.isActive, deps.log);

    await rankedCheckinPass("1v1", gate, deps);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchFn).mock.calls[0];
    expect(url).toBe("https://api.openfront.io/matchmaking/checkin");
    const body = JSON.parse(String((init as RequestInit).body));
    // The body is unchanged by OPE-469; the API keys its queue off it.
    expect(body).toMatchObject({
      id: 0,
      ccu: 3,
      instanceId: "abcd1234",
      mode: "1v1",
    });
    expect(typeof body.gameId).toBe("string");
  });

  it("does not open the long poll while the deployment is draining", async () => {
    const fetchFn = okFetch({ assignment: null });
    const deps = makeDeps(() => false, fetchFn);
    const gate = new RankedCheckinGate(deps.isActive, deps.log);

    await rankedCheckinPass("1v1", gate, deps);
    await rankedCheckinPass("2v2", gate, deps);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(deps.log.info).toHaveBeenCalledWith(RANKED_PAUSED_LOG);
  });

  it("resumes checking in when the deployment becomes active again", async () => {
    let active = true;
    const fetchFn = okFetch({ assignment: null });
    const deps = makeDeps(() => active, fetchFn);
    const gate = new RankedCheckinGate(deps.isActive, deps.log);

    await rankedCheckinPass("1v1", gate, deps);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    active = false;
    await rankedCheckinPass("1v1", gate, deps);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    active = true;
    await rankedCheckinPass("1v1", gate, deps);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(deps.log.info).toHaveBeenCalledWith(RANKED_RESUMED_LOG);
  });

  it("creates the assigned game with the matched players and teams", async () => {
    const fetchFn = okFetch({
      assignment: { players: ["p1", "p2"], teams: [["p1"], ["p2"]] },
    });
    const deps = makeDeps(() => true, fetchFn);
    const gate = new RankedCheckinGate(deps.isActive, deps.log);

    await rankedCheckinPass("2v2", gate, deps);

    expect(deps.gm.createGame).toHaveBeenCalledTimes(1);
    const call = vi.mocked(deps.gm.createGame).mock.calls[0];
    expect(call[1]).toMatchObject({ allowedPublicIds: ["p1", "p2"] });
    expect(call[5]).toEqual([["p1"], ["p2"]]);
  });

  it("never touches games already assigned: a drained pass creates nothing", async () => {
    const fetchFn = okFetch({
      assignment: { players: ["p1", "p2"], teams: [["p1"], ["p2"]] },
    });
    const deps = makeDeps(() => false, fetchFn);
    const gate = new RankedCheckinGate(deps.isActive, deps.log);

    await rankedCheckinPass("1v1", gate, deps);

    expect(deps.gm.createGame).not.toHaveBeenCalled();
  });

  it("treats an aborted long poll as the empty-queue case, not an error", async () => {
    const fetchFn = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    const deps = makeDeps(() => true, fetchFn);
    const gate = new RankedCheckinGate(deps.isActive, deps.log);

    await rankedCheckinPass("1v1", gate, deps);

    expect(deps.log.error).not.toHaveBeenCalled();
  });
});
