// Regression test for the cluster worker lifecycle: when the master dies,
// every worker must exit too. Node's cluster does this implicitly; Bun's
// does not, which orphaned workers that kept their ports bound (via
// SO_REUSEPORT) and served stale state next to a restarted server. Worker.ts
// now exits explicitly on IPC disconnect — this test pins that behavior on
// both runtimes.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RUNTIME, TestServer, waitFor } from "./util";

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe(`worker lifecycle (runtime: ${RUNTIME})`, () => {
  const server = new TestServer();

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  test("workers exit when the master is killed", async () => {
    const workerPids = server.workerPids();
    expect(workerPids.length).toBeGreaterThanOrEqual(2);
    for (const pid of workerPids) {
      expect(pidAlive(pid)).toBe(true);
    }

    const masterPid = server.masterPid();
    expect(masterPid).not.toBeNull();
    // SIGKILL: the harshest case — no signal handler can run, only the IPC
    // channel closing tells the workers their master is gone.
    process.kill(masterPid!, "SIGKILL");

    await waitFor(
      () => workerPids.every((pid) => !pidAlive(pid)),
      10_000,
      `workers ${workerPids.join(",")} to exit after master SIGKILL`,
    );
  });
});
