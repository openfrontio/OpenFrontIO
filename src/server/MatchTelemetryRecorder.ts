import { Client } from "./Client";
import {
  type MatchTelemetryEmitter,
  type MatchTelemetryEvent,
  type MatchTelemetryPayloads,
  type MatchTelemetryType,
  type TelemetryPlayerIdentity,
} from "./telemetry/MatchTelemetry";

// One match's view of the telemetry stream: stamps every event with the
// match id, a per-match sequence number and the server tick, keeps the
// per-tick intent counters the turn_committed event reports, and makes sure
// match_finished goes out once. The emitter itself (batching, delivery,
// counters across matches) is MatchTelemetry.ts.

export interface TickCounts {
  observed: number;
  enqueued: number;
  dropped: number;
}

export function identityFor(client: Client): TelemetryPlayerIdentity {
  // persistentID is deliberately excluded from telemetry identity.
  return {
    clientId: client.clientID,
    publicId: client.publicId,
  };
}

export class MatchTelemetryRecorder {
  private sequence = 0;
  private tickCounts = new Map<number, TickCounts>();
  private replayArchiveAttempted = false;
  private finished = false;

  constructor(
    private readonly emitter: MatchTelemetryEmitter,
    private readonly matchId: string,
    private readonly buildHash: string,
  ) {}

  // Emits one event. An emitter that throws counts as a drop; the sequence
  // number is consumed either way, so gaps in it mean drops.
  emit<K extends MatchTelemetryType>(
    type: K,
    payload: MatchTelemetryPayloads[K],
    serverTick: number,
  ): "enqueued" | "dropped" {
    const event = {
      schemaVersion: 1,
      type,
      matchId: this.matchId,
      sequence: this.sequence++,
      observedAt: Date.now(),
      serverTick,
      payload,
    } as MatchTelemetryEvent;
    try {
      return this.emitter.emit(event);
    } catch {
      return "dropped";
    }
  }

  // Records an intent the server saw for `serverTick`, and counts it toward
  // that tick's turn_committed summary.
  intentObserved(
    client: Client,
    intent: unknown,
    intentType: string | null,
    outcome: "accepted" | "rejected",
    serverTick: number,
    reasonCode?: string,
    reasonDetail?: string,
  ): void {
    const counts = this.tickCounts.get(serverTick) ?? {
      observed: 0,
      enqueued: 0,
      dropped: 0,
    };
    counts.observed++;
    const result = this.emit(
      "intent_observed",
      {
        identity: identityFor(client),
        intentType,
        outcome,
        reasonCode,
        reasonDetail,
        intent,
      },
      serverTick,
    );
    counts[result === "enqueued" ? "enqueued" : "dropped"]++;
    this.tickCounts.set(serverTick, counts);
  }

  // The intent counters for a tick, cleared once taken: the turn has been
  // committed and reported, so nothing more can be counted toward it.
  takeTickCounts(serverTick: number): TickCounts {
    const counts = this.tickCounts.get(serverTick) ?? {
      observed: 0,
      enqueued: 0,
      dropped: 0,
    };
    this.tickCounts.delete(serverTick);
    return counts;
  }

  // The game handed its record to the archive (whether or not the upload
  // then succeeded); reported in match_finished.
  noteArchiveAttempted(): void {
    this.replayArchiveAttempted = true;
  }

  // Emits match_finished the first time it is called, and nothing after:
  // end() can run more than once.
  matchFinished(totalTurns: number): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.emit(
      "match_finished",
      {
        endedAt: Date.now(),
        totalTurns,
        buildHash: this.buildHash,
        replayArchiveAttempted: this.replayArchiveAttempted,
      },
      totalTurns,
    );
  }
}
