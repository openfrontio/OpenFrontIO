import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  identityFor,
  MatchTelemetryRecorder,
} from "../../src/server/MatchTelemetryRecorder";
import type {
  MatchTelemetryCounters,
  MatchTelemetryEmitter,
  MatchTelemetryEvent,
} from "../../src/server/telemetry/MatchTelemetry";
import { cid, makeClient } from "../util/GameServerHarness";

// The per-match recorder on its own: the envelope, the sequence, the
// per-tick intent counters, finished-once. Which events the game emits when
// is covered through GameServer in MatchTelemetryIntegration.test.ts.

class RecordingEmitter implements MatchTelemetryEmitter {
  events: MatchTelemetryEvent[] = [];
  // Returned by emit(); tests flip it to simulate a full queue.
  verdict: "enqueued" | "dropped" = "enqueued";
  throwing = false;

  emit(event: MatchTelemetryEvent) {
    if (this.throwing) throw new Error("emitter down");
    this.events.push(event);
    return this.verdict;
  }

  counters(): MatchTelemetryCounters {
    throw new Error("not used");
  }

  stop() {}
}

const T0 = 1_700_000_000_000;
const MATCH = cid("match");

describe("MatchTelemetryRecorder", () => {
  let emitter: RecordingEmitter;
  let recorder: MatchTelemetryRecorder;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    emitter = new RecordingEmitter();
    recorder = new MatchTelemetryRecorder(emitter, MATCH, "build-1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps every event with the match, a running sequence and the tick", () => {
    recorder.emit("match_opened", {} as never, 0);
    vi.setSystemTime(T0 + 5);
    recorder.emit("turn_committed", {} as never, 7);

    expect(emitter.events).toMatchObject([
      {
        schemaVersion: 1,
        type: "match_opened",
        matchId: MATCH,
        sequence: 0,
        observedAt: T0,
        serverTick: 0,
      },
      {
        type: "turn_committed",
        matchId: MATCH,
        sequence: 1,
        observedAt: T0 + 5,
        serverTick: 7,
      },
    ]);
  });

  it("reports an emitter that throws as a drop and keeps counting", () => {
    emitter.throwing = true;
    expect(recorder.emit("match_opened", {} as never, 0)).toBe("dropped");
    emitter.throwing = false;
    expect(recorder.emit("match_opened", {} as never, 0)).toBe("enqueued");
    // The sequence number was consumed by the drop: a gap marks it.
    expect(emitter.events.map((e) => e.sequence)).toEqual([1]);
  });

  it("counts observed intents per tick as enqueued or dropped", () => {
    const client = makeClient({ clientID: cid("p1"), publicId: "p1-pub" });
    recorder.intentObserved(client, { type: "spawn" }, "spawn", "accepted", 3);
    emitter.verdict = "dropped";
    recorder.intentObserved(
      client,
      { type: "spawn" },
      "spawn",
      "rejected",
      3,
      "409",
    );
    recorder.intentObserved(client, { type: "spawn" }, "spawn", "accepted", 4);

    expect(recorder.takeTickCounts(3)).toEqual({
      observed: 2,
      enqueued: 1,
      dropped: 1,
    });
    expect(recorder.takeTickCounts(4)).toEqual({
      observed: 1,
      enqueued: 0,
      dropped: 1,
    });
    expect(emitter.events[0]).toMatchObject({
      type: "intent_observed",
      serverTick: 3,
      payload: {
        identity: { clientId: cid("p1"), publicId: "p1-pub" },
        intentType: "spawn",
        outcome: "accepted",
        intent: { type: "spawn" },
      },
    });
    expect(emitter.events[1].payload).toMatchObject({
      outcome: "rejected",
      reasonCode: "409",
    });
  });

  it("hands out zero counts for a tick nothing was observed in, and clears a tick once taken", () => {
    expect(recorder.takeTickCounts(9)).toEqual({
      observed: 0,
      enqueued: 0,
      dropped: 0,
    });
    const client = makeClient();
    recorder.intentObserved(client, {}, null, "accepted", 2);
    recorder.takeTickCounts(2);
    expect(recorder.takeTickCounts(2)).toEqual({
      observed: 0,
      enqueued: 0,
      dropped: 0,
    });
  });

  it("emits match_finished once, saying whether the record was archived", () => {
    recorder.matchFinished(12);
    recorder.matchFinished(12);
    expect(emitter.events).toHaveLength(1);
    expect(emitter.events[0]).toMatchObject({
      type: "match_finished",
      serverTick: 12,
      payload: {
        endedAt: T0,
        totalTurns: 12,
        buildHash: "build-1",
        replayArchiveAttempted: false,
      },
    });

    const archived = new MatchTelemetryRecorder(emitter, MATCH, "build-1");
    archived.noteArchiveAttempted();
    archived.matchFinished(3);
    expect(emitter.events[1].payload).toMatchObject({
      replayArchiveAttempted: true,
    });
  });
});

describe("identityFor", () => {
  it("carries the client and account ids, never the persistentID", () => {
    const client = makeClient({
      clientID: cid("p1"),
      persistentID: "secret-pid",
      publicId: "p1-pub",
    });
    expect(identityFor(client)).toEqual({
      clientId: cid("p1"),
      publicId: "p1-pub",
    });
    expect(JSON.stringify(identityFor(client))).not.toContain("secret-pid");
  });
});
