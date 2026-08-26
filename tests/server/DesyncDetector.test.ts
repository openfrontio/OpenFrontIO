import { describe, expect, it } from "vitest";
import { Client } from "../../src/server/Client";
import {
  DesyncDetector,
  findOutOfSyncClients,
} from "../../src/server/DesyncDetector";
import { cid, makeClient } from "../util/GameServerHarness";

// The hash tally and the detector's bookkeeping on their own. What the turn
// loop does with a verdict (the desync frame, the recorded hash) is covered
// through GameServer in GameServerDesync.test.ts.

const IDS = ["a", "b", "c", "d"].map(cid);

function clients(count: number): Client[] {
  return IDS.slice(0, count).map((clientID) => makeClient({ clientID }));
}

// What the server does when a client's hash message arrives.
const report = (client: Client, turnNumber: number, hash: number) =>
  client.hashes.set(turnNumber, hash);

describe("findOutOfSyncClients", () => {
  it("flags the minority that disagrees with the majority hash", () => {
    const [a, b, c] = clients(3);
    report(a, 0, 1);
    report(b, 0, 1);
    report(c, 0, 2);

    expect(findOutOfSyncClients([a, b, c], 0)).toEqual({
      mostCommonHash: 1,
      outOfSyncClients: [c],
    });
  });

  it("treats everyone as out of sync when no hash has a majority", () => {
    // Three different answers: whichever hash was seen first "wins" the
    // count, but with a strict majority disagreeing nobody can be trusted.
    const [a, b, c] = clients(3);
    report(a, 0, 1);
    report(b, 0, 2);
    report(c, 0, 3);

    expect(findOutOfSyncClients([a, b, c], 0)).toEqual({
      mostCommonHash: 1,
      outOfSyncClients: [a, b, c],
    });
  });

  it("keeps an even split as-is, siding with the first-seen hash", () => {
    // Two of four is not a STRICT majority, so only the second pair is
    // flagged rather than the whole room.
    const [a, b, c, d] = clients(4);
    report(a, 0, 1);
    report(b, 0, 1);
    report(c, 0, 2);
    report(d, 0, 2);

    expect(findOutOfSyncClients([a, b, c, d], 0)).toEqual({
      mostCommonHash: 1,
      outOfSyncClients: [c, d],
    });
  });

  it("ignores clients that have not reported that turn", () => {
    const [a, b, c] = clients(3);
    report(a, 0, 1);
    report(b, 0, 1);
    report(b, 1, 7); // a different turn does not count either

    expect(findOutOfSyncClients([a, b, c], 0)).toEqual({
      mostCommonHash: 1,
      outOfSyncClients: [],
    });
  });

  it("has nothing to compare with one report, or none", () => {
    const [a] = clients(1);
    expect(findOutOfSyncClients([a], 0)).toEqual({
      mostCommonHash: null,
      outOfSyncClients: [],
    });

    report(a, 0, 1);
    expect(findOutOfSyncClients([a], 0)).toEqual({
      mostCommonHash: 1,
      outOfSyncClients: [],
    });
  });

  it("does not hand back the caller's array when everyone is flagged", () => {
    const active = clients(2);
    report(active[0], 0, 1);
    report(active[1], 0, 2);
    expect(findOutOfSyncClients(active, 0).outOfSyncClients).not.toBe(active);
  });
});

describe("DesyncDetector", () => {
  it("checks the turn ten back, once every ten turns", () => {
    const detector = new DesyncDetector();
    const active = clients(2);
    for (let committed = 1; committed < 10; committed++) {
      expect(detector.check(committed, active)).toBeNull();
    }
    expect(detector.check(10, active)?.turn).toBe(0);
    expect(detector.check(11, active)).toBeNull();
    expect(detector.check(20, active)?.turn).toBe(10);
  });

  it("has nothing to check with a single client", () => {
    const active = clients(1);
    report(active[0], 0, 1);
    expect(new DesyncDetector().check(10, active)).toBeNull();
  });

  it("returns the tally for the turn it checks", () => {
    const [a, b, c] = clients(3);
    report(a, 0, 1);
    report(b, 0, 1);
    report(c, 0, 2);
    expect(new DesyncDetector().check(10, [a, b, c])).toEqual({
      turn: 0,
      mostCommonHash: 1,
      outOfSyncClients: [c],
    });
  });

  it("counts a client once, and reports it for notice only the first time", () => {
    const detector = new DesyncDetector();
    const [b, c] = clients(2);

    expect(detector.record([c])).toEqual([c]);
    expect(detector.count()).toBe(1);
    expect(detector.isDesynced(c.clientID)).toBe(true);
    expect(detector.isDesynced(b.clientID)).toBe(false);

    // c disagrees again, b for the first time: only b is new.
    expect(detector.record([c, b])).toEqual([b]);
    expect(detector.count()).toBe(2);
  });

  it("does not count anyone a check merely looked at", () => {
    const detector = new DesyncDetector();
    const [a, b] = clients(2);
    report(a, 0, 1);
    report(b, 0, 2);
    detector.check(10, [a, b]);
    expect(detector.count()).toBe(0);
  });
});
