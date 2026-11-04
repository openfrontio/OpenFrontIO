import {
  decodePartyServerMessage,
  encodePartyClientMessage,
  PARTY_MAX_SIZE,
  PartyClientMessage,
  PartyServerMessage,
} from "@openfront/shared/PartySchemas";
import { describe, expect, test } from "vitest";
import { PartyConnection, PartyService } from "../../src/server/PartyService";

class FakeConn implements PartyConnection {
  received: PartyServerMessage[] = [];
  closed = false;
  send(data: Uint8Array) {
    this.received.push(decodePartyServerMessage(data));
  }
  close() {
    this.closed = true;
  }
  last<T extends PartyServerMessage["type"]>(
    type: T,
  ): Extract<PartyServerMessage, { type: T }> | undefined {
    for (let i = this.received.length - 1; i >= 0; i--) {
      const m = this.received[i];
      if (m.type === type) return m as Extract<PartyServerMessage, { type: T }>;
    }
    return undefined;
  }
}

// Manual timers so grace and hello timeouts run on demand.
function harness() {
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let nextID = 0;
  const service = new PartyService({
    mintPartyID: () => `Party${String(++nextID).padStart(5, "0")}`,
    graceMs: 1000,
    setTimer: (cb) => {
      const id = nextTimer++;
      timers.set(id, cb);
      return id;
    },
    clearTimer: (h) => timers.delete(h as number),
  });
  const runTimers = () => {
    const pending = [...timers.entries()];
    timers.clear();
    for (const [, cb] of pending) cb();
  };
  const connect = () => {
    const conn = new FakeConn();
    service.onOpen(conn);
    return conn;
  };
  const say = (conn: FakeConn, msg: PartyClientMessage) =>
    service.onMessage(conn, encodePartyClientMessage(msg));
  const hello = (
    conn: FakeConn,
    username: string,
    partyID?: string,
    resumeToken?: string,
  ) =>
    say(conn, { type: "hello", username, clanTag: null, partyID, resumeToken });
  return { service, connect, say, hello, runTimers };
}

describe("PartyService", () => {
  test("creating a party makes the creator its leader", () => {
    const h = harness();
    const a = h.connect();
    h.hello(a, "Alice");
    const state = a.last("state")!;
    expect(state.partyID).toBe("Party00001");
    expect(state.leaderID).toBe(state.selfID);
    expect(state.members.map((m) => m.username)).toEqual(["Alice"]);
  });

  test("members join by code and see each other", () => {
    const h = harness();
    const a = h.connect();
    h.hello(a, "Alice");
    const b = h.connect();
    h.hello(b, "Bobby", a.last("state")!.partyID);
    expect(a.last("state")!.members.map((m) => m.username)).toEqual([
      "Alice",
      "Bobby",
    ]);
    expect(b.last("state")!.leaderID).toBe(a.last("state")!.selfID);
  });

  test("an unknown code is refused", () => {
    const h = harness();
    const a = h.connect();
    h.hello(a, "Alice", "NoSuchPrty");
    expect(a.last("closed")?.reason).toBe("not_found");
    expect(a.closed).toBe(true);
  });

  test("a full party refuses newcomers", () => {
    const h = harness();
    const leader = h.connect();
    h.hello(leader, "Leader");
    const id = leader.last("state")!.partyID;
    for (let i = 1; i < PARTY_MAX_SIZE; i++)
      h.hello(h.connect(), `Member${i}`, id);
    const late = h.connect();
    h.hello(late, "Latecomer", id);
    expect(late.last("closed")?.reason).toBe("full");
  });

  test("only the leader's follow reaches the other members", () => {
    const h = harness();
    const a = h.connect();
    h.hello(a, "Alice");
    const id = a.last("state")!.partyID;
    const b = h.connect();
    h.hello(b, "Bobby", id);
    h.say(b, { type: "follow", gameID: "Game000001" });
    expect(a.last("follow")).toBeUndefined();
    h.say(a, { type: "follow", gameID: "Game000002" });
    expect(b.last("follow")?.gameID).toBe("Game000002");
    expect(a.last("follow")).toBeUndefined();
    expect(b.last("state")!.gameID).toBe("Game000002");
  });

  test("the leader can kick and promote", () => {
    const h = harness();
    const a = h.connect();
    h.hello(a, "Alice");
    const id = a.last("state")!.partyID;
    const b = h.connect();
    h.hello(b, "Bobby", id);
    const c = h.connect();
    h.hello(c, "Carol", id);
    const bID = b.last("state")!.selfID;
    const cID = c.last("state")!.selfID;
    // A member can't kick.
    h.say(b, { type: "kick", memberID: cID });
    expect(c.closed).toBe(false);
    h.say(a, { type: "kick", memberID: cID });
    expect(c.last("closed")?.reason).toBe("kicked");
    expect(a.last("state")!.members).toHaveLength(2);
    h.say(a, { type: "promote", memberID: bID });
    expect(a.last("state")!.leaderID).toBe(bID);
  });

  test("a dropped member keeps the seat during the grace and can resume", () => {
    const h = harness();
    const a = h.connect();
    h.hello(a, "Alice");
    const state = a.last("state")!;
    const b = h.connect();
    h.hello(b, "Bobby", state.partyID);
    h.service.onClose(a);
    const seen = b.last("state")!;
    expect(seen.leaderID).toBe(state.selfID);
    expect(seen.members[0].connected).toBe(false);
    const a2 = h.connect();
    h.hello(a2, "Alice", state.partyID, state.resumeToken);
    const resumed = a2.last("state")!;
    expect(resumed.selfID).toBe(state.selfID);
    expect(resumed.leaderID).toBe(state.selfID);
    expect(resumed.members).toHaveLength(2);
    // The old grace timer must not remove the resumed member.
    h.runTimers();
    expect(b.last("state")!.members).toHaveLength(2);
  });

  test("after the grace the dropped leader is replaced", () => {
    const h = harness();
    const a = h.connect();
    h.hello(a, "Alice");
    const id = a.last("state")!.partyID;
    const b = h.connect();
    h.hello(b, "Bobby", id);
    h.service.onClose(a);
    h.runTimers();
    const state = b.last("state")!;
    expect(state.members.map((m) => m.username)).toEqual(["Bobby"]);
    expect(state.leaderID).toBe(state.selfID);
  });

  test("the last member leaving ends the party", () => {
    const h = harness();
    const a = h.connect();
    h.hello(a, "Alice");
    expect(h.service.partyCount()).toBe(1);
    h.say(a, { type: "leave" });
    expect(h.service.partyCount()).toBe(0);
    expect(a.last("closed")?.reason).toBe("left");
  });

  test("a socket that never says hello is closed", () => {
    const h = harness();
    const a = h.connect();
    h.runTimers();
    expect(a.closed).toBe(true);
    expect(h.service.connectionCount()).toBe(0);
  });

  test("garbage before hello is refused", () => {
    const h = harness();
    const a = h.connect();
    h.service.onMessage(a, new Uint8Array([0xff, 0xff, 0xff]));
    expect(a.last("closed")?.reason).toBe("invalid");
  });
});
