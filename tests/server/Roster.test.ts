import { CloseCode, CloseReason } from "@openfront/shared/CloseCodes";
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

  it("records admission via markAdmitted prior to client add and overrides on kick", () => {
    const roster = new Roster();
    const pid = "pre-admit-pid";

    expect(roster.wasAdmitted(pid)).toBe(false);
    expect(roster.byPersistentId(pid)).toBeUndefined();

    // Mark admitted before the client is seated in Roster
    roster.markAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(true);
    // Still not reconnectable / active since add() hasn't been called
    expect(roster.byPersistentId(pid)).toBeUndefined();
    expect(roster.active()).toEqual([]);

    // Now seat the client
    const p1 = makeClient({ clientID: cid("p1"), persistentID: pid });
    roster.add(p1);
    expect(roster.wasAdmitted(pid)).toBe(true);
    expect(roster.byPersistentId(pid)).toBe(p1);

    // Kicking overrides wasAdmitted
    roster.kick(p1);
    expect(roster.isKicked(pid)).toBe(true);
    expect(roster.wasAdmitted(pid)).toBe(false);

    // Calling markAdmitted on a kicked account still yields false for wasAdmitted
    roster.markAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(false);
  });

  it("removes admission via unmarkAdmitted", () => {
    const roster = new Roster();
    const pid = "test-pid";
    roster.markAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(true);
    roster.unmarkAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(false);
  });

  it("handles unmarkAdmitted on non-admitted ID and allows re-admission", () => {
    const roster = new Roster();
    const pid = "test-pid-2";
    expect(roster.wasAdmitted(pid)).toBe(false);
    roster.unmarkAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(false);
    roster.markAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(true);
    roster.unmarkAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(false);
  });

  it("tracks multiple pending attempts and clears admission only when all roll back", () => {
    const roster = new Roster();
    const pid = "multi-attempt-pid";
    const attempt1 = "att-1";
    const attempt2 = "att-2";

    roster.markAdmitted(pid, attempt1);
    expect(roster.wasAdmitted(pid)).toBe(true);

    roster.markAdmitted(pid, attempt2);
    expect(roster.wasAdmitted(pid)).toBe(true);

    // Attempt 1 rolls back, but Attempt 2 is still pending
    roster.unmarkAdmitted(pid, attempt1);
    expect(roster.wasAdmitted(pid)).toBe(true);

    // Attempt 2 rolls back, no more pending attempts
    roster.unmarkAdmitted(pid, attempt2);
    expect(roster.wasAdmitted(pid)).toBe(false);
  });

  it("preserves backwards compatibility when no attemptID is passed", () => {
    const roster = new Roster();
    const pid = "compat-pid";

    roster.markAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(true);

    roster.unmarkAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(false);
  });

  it("clears pending attempts when client is seated or kicked", () => {
    const roster = new Roster();
    const pid = "seated-clear-pid";
    const attempt1 = "att-1";

    roster.markAdmitted(pid, attempt1);
    expect(roster.wasAdmitted(pid)).toBe(true);

    const client = makeClient({ clientID: cid("p1"), persistentID: pid });
    roster.add(client);
    expect(roster.hasEverBeenSeated(pid)).toBe(true);

    // Rollback of attempt1 after seating is a no-op
    roster.unmarkAdmitted(pid, attempt1);
    expect(roster.wasAdmitted(pid)).toBe(true);
  });

  it("clears pending attempts when client is kicked", () => {
    const roster = new Roster();
    const pid = "kicked-clear-pid";
    const attempt1 = "att-1";

    roster.markAdmitted(pid, attempt1);
    expect(roster.wasAdmitted(pid)).toBe(true);

    const client = makeClient({ clientID: cid("p1"), persistentID: pid });
    roster.add(client);
    roster.kick(client);
    expect(roster.isKicked(pid)).toBe(true);
    expect(roster.wasAdmitted(pid)).toBe(false);
  });

  it("does not clear admission on unmarkAdmitted without attemptID if another attempt is pending", () => {
    const roster = new Roster();
    const pid = "pending-pid";
    roster.markAdmitted(pid, "att-1");
    expect(roster.wasAdmitted(pid)).toBe(true);

    roster.unmarkAdmitted(pid); // no attemptID
    expect(roster.wasAdmitted(pid)).toBe(true);

    roster.unmarkAdmitted(pid, "att-1");
    expect(roster.wasAdmitted(pid)).toBe(false);
  });

  it("does not remove admission on unmarkAdmitted if the persistent ID is currently reconnectable", () => {
    const roster = new Roster();
    const pid = "seated-reconnectable-pid";
    const client = makeClient({ clientID: cid("p1"), persistentID: pid });
    roster.add(client);

    expect(roster.wasAdmitted(pid)).toBe(true);
    expect(roster.byPersistentId(pid)).toBe(client);

    roster.unmarkAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(true);

    // Still reconnectable after markLeft (socket disconnected, e.g. in active game)
    roster.markLeft(client);
    roster.unmarkAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(true);
  });

  it("retains wasAdmitted true when an admitted player leaves via forgetReconnect", () => {
    const roster = new Roster();
    const pid = "leave-pid";
    const client = makeClient({ clientID: cid("p1"), persistentID: pid });
    roster.add(client);
    expect(roster.wasAdmitted(pid)).toBe(true);

    roster.markLeft(client);
    roster.forgetReconnect(client);

    expect(roster.byPersistentId(pid)).toBeUndefined();
    expect(roster.wasAdmitted(pid)).toBe(true);

    // Because the player was seated in roster.add, unmarkAdmitted does not delete admission
    roster.unmarkAdmitted(pid);
    expect(roster.wasAdmitted(pid)).toBe(true);
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
    roster.closeAll(CloseReason.GameEnded);
    expect(oldWs.close).toHaveBeenCalledOnce();
    expect(newWs.close).toHaveBeenCalledWith(
      CloseCode.Normal,
      CloseReason.GameEnded,
    );
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
    roster.closeAll(CloseReason.GameEnded);
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

  it("does not delete reconnectable mapping if it belongs to a newer client session", () => {
    const roster = new Roster();
    const oldSession = makeClient({
      clientID: cid("old"),
      persistentID: "p1-pid",
    });
    roster.add(oldSession);
    const newSession = makeClient({
      clientID: cid("new"),
      persistentID: "p1-pid",
    });
    roster.add(newSession);

    // Stale disconnect from old session
    roster.forgetReconnect(oldSession);

    expect(roster.byPersistentId("p1-pid")).toBe(newSession);
  });

  it("bans a kicked account whether or not it is connected", () => {
    const roster = new Roster();
    const p1 = makeClient({ clientID: cid("p1"), persistentID: "p1-pid" });
    const p2 = makeClient({ clientID: cid("p2"), persistentID: "p2-pid" });
    roster.add(p1);
    roster.add(p2);

    expect(roster.kick(p1)).toEqual([p1]);
    expect(roster.active()).toEqual([p2]);
    expect(roster.isKicked("p1-pid")).toBe(true);
    expect(roster.wasAdmitted("p1-pid")).toBe(false);
    // The reconnect mapping is raw; refusing a kicked account is the
    // caller's check.
    expect(roster.byPersistentId("p1-pid")).toBe(p1);

    roster.markLeft(p2);
    expect(roster.kick(p2)).toEqual([]);
    expect(roster.isKicked("p2-pid")).toBe(true);
  });

  it("drops every connected session of a kicked account", () => {
    const roster = new Roster();
    const stale = makeClient({ clientID: cid("old"), persistentID: "p1-pid" });
    const live = makeClient({ clientID: cid("new"), persistentID: "p1-pid" });
    const other = makeClient({ clientID: cid("p2"), persistentID: "p2-pid" });
    roster.add(stale);
    roster.markLeft(stale);
    roster.add(live);
    roster.add(other);

    // Kicking the left record still cuts off the session that replaced it.
    expect(roster.kick(stale)).toEqual([live]);
    expect(roster.active()).toEqual([other]);
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
