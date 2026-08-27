import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Roster } from "../../src/server/Roster";
import {
  cid,
  makeClient,
  makeMockWs,
  mockWsOf,
} from "../util/GameServerHarness";

// The roster bookkeeping on its own. The policy that decides what to call —
// allowlist, IP cap, duplicate sessions, host-left, the kicked checks on
// join and reconnect — is covered through GameServer in GameServerJoin,
// GameServerRejoin and AdminBotIntent.

const T0 = 1_700_000_000_000;

describe("Roster", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a client as connected, known, admitted and reconnectable", () => {
    const roster = new Roster();
    const p1 = makeClient({ clientID: cid("p1"), persistentID: "p1-pid" });
    const p2 = makeClient({ clientID: cid("p2") });
    roster.add(p1);
    roster.add(p2);

    expect(roster.active()).toEqual([p1, p2]);
    expect(roster.all().size).toBe(2);
    expect(roster.get(cid("p1"))).toBe(p1);
    expect(roster.byPersistentId("p1-pid")).toBe(p1);
    expect(roster.wasAdmitted("p1-pid")).toBe(true);
    expect(roster.isKicked("p1-pid")).toBe(false);
    expect(roster.byPersistentId("nobody")).toBeUndefined();
    expect(roster.wasAdmitted("nobody")).toBe(false);
  });

  it("moves a reconnecting client to the end, on the new socket, and drops the old one", () => {
    const roster = new Roster();
    const p1 = makeClient({ clientID: cid("p1") });
    const p2 = makeClient({ clientID: cid("p2") });
    roster.add(p1);
    roster.add(p2);
    const oldWs = mockWsOf(p1);
    const newWs = makeMockWs();

    roster.reconnect(p1, newWs as any);

    expect(roster.active()).toEqual([p2, p1]);
    expect(p1.ws).toBe(newWs);
    expect(oldWs.close).toHaveBeenCalledOnce();
    // Forgotten, not just closed: even reopened it is no longer the game's
    // to close.
    oldWs.readyState = 1;
    roster.closeAll("bye");
    expect(oldWs.close).toHaveBeenCalledOnce();
    expect(newWs.close).toHaveBeenCalledWith(1000, "bye");
  });

  it("keeps the socket when a client reconnects on the one it already has", () => {
    const roster = new Roster();
    const p1 = makeClient({ clientID: cid("p1") });
    roster.add(p1);
    roster.reconnect(p1, p1.ws);
    expect(mockWsOf(p1).close).not.toHaveBeenCalled();
    expect(roster.active()).toEqual([p1]);
  });

  it("keeps the record and the reconnect mapping of a client who left", () => {
    const roster = new Roster();
    const p1 = makeClient({ clientID: cid("p1"), persistentID: "p1-pid" });
    roster.add(p1);
    roster.markLeft(p1);

    expect(roster.active()).toEqual([]);
    expect(roster.get(cid("p1"))).toBe(p1);
    expect(roster.byPersistentId("p1-pid")).toBe(p1);
    expect(roster.wasAdmitted("p1-pid")).toBe(true);
    // Their socket is no longer the game's to close.
    roster.closeAll("bye");
    expect(mockWsOf(p1).close).not.toHaveBeenCalled();
  });

  it("frees the seat on forgetReconnect but keeps the admission", () => {
    const roster = new Roster();
    const p1 = makeClient({ clientID: cid("p1"), persistentID: "p1-pid" });
    roster.add(p1);
    roster.markLeft(p1);
    roster.forgetReconnect(p1);

    expect(roster.byPersistentId("p1-pid")).toBeUndefined();
    expect(roster.wasAdmitted("p1-pid")).toBe(true);
    expect(roster.get(cid("p1"))).toBe(p1);
  });

  it("bans a kicked account whether or not it is connected", () => {
    const roster = new Roster();
    const p1 = makeClient({ clientID: cid("p1"), persistentID: "p1-pid" });
    const p2 = makeClient({ clientID: cid("p2"), persistentID: "p2-pid" });
    roster.add(p1);
    roster.add(p2);

    expect(roster.kick(p1)).toBe(true);
    expect(roster.active()).toEqual([p2]);
    expect(roster.isKicked("p1-pid")).toBe(true);
    expect(roster.wasAdmitted("p1-pid")).toBe(false);
    // The reconnect mapping is raw; refusing a kicked account is the
    // caller's check.
    expect(roster.byPersistentId("p1-pid")).toBe(p1);

    roster.markLeft(p2);
    expect(roster.kick(p2)).toBe(false);
    expect(roster.isKicked("p2-pid")).toBe(true);
  });

  it("prunes clients silent for longer than the limit and hands them back", () => {
    const roster = new Roster();
    const p1 = makeClient({ clientID: cid("p1") });
    const p2 = makeClient({ clientID: cid("p2") });
    const p3 = makeClient({ clientID: cid("p3") });
    roster.add(p1);
    roster.add(p2);
    roster.add(p3);
    p2.lastPing = T0 - 60_001;
    // Exactly at the limit is not yet stale.
    p3.lastPing = T0 - 60_000;

    expect(roster.pruneStale(T0, 60_000)).toEqual([p2]);
    expect(roster.active()).toEqual([p1, p3]);
    expect(roster.pruneStale(T0, 60_000)).toEqual([]);
  });

  it("leaves spectators out of the players and counts each voting IP once", () => {
    const roster = new Roster();
    const p1 = makeClient({ clientID: cid("p1"), ip: "1.1.1.1" });
    const p2 = makeClient({ clientID: cid("p2"), ip: "1.1.1.1" });
    const p3 = makeClient({ clientID: cid("p3"), ip: "2.2.2.2" });
    const s1 = makeClient({
      clientID: cid("s1"),
      ip: "3.3.3.3",
      spectator: true,
    });
    for (const c of [p1, p2, p3, s1]) roster.add(c);

    expect(roster.active()).toHaveLength(4);
    expect(roster.players()).toEqual([p1, p2, p3]);
    expect(roster.votingUniqueIPs()).toBe(2);
  });

  it("treats a client as disconnected until told otherwise", () => {
    const roster = new Roster();
    expect(roster.isDisconnected(cid("p1"))).toBe(true);
    roster.setDisconnected(cid("p1"), false);
    expect(roster.isDisconnected(cid("p1"))).toBe(false);
    roster.setDisconnected(cid("p1"), true);
    expect(roster.isDisconnected(cid("p1"))).toBe(true);
  });
});
