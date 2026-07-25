import type {
  GameConfig,
  GameStartInfo,
  PublicGameType,
} from "../../core/Schemas";

export interface TelemetryPlayerIdentity {
  clientId: string;
  publicId?: string;
}

export interface MatchTelemetryPayloads {
  match_opened: {
    lobbyCreatedAt: number;
    config: GameConfig;
    publicGameType?: PublicGameType;
    buildHash: string;
    instanceId: string;
    workerId?: number;
    turnIntervalMs: number;
  };
  player_joined: {
    identity: TelemetryPlayerIdentity;
    joinedAt: number;
    username: string;
    playerType: "human";
    teamIndex?: number;
  };
  match_started: {
    startedAt: number;
    gameStartInfo: GameStartInfo;
    buildHash: string;
    turnIntervalMs: number;
  };
  intent_observed: {
    identity: TelemetryPlayerIdentity;
    intentType: string | null;
    outcome: "accepted" | "rejected";
    reasonCode?: string;
    reasonDetail?: string;
    intent: unknown;
  };
  turn_committed: {
    turnNumber: number;
    replayIntentCount: number;
    observed: number;
    enqueued: number;
    dropped: number;
  };
  match_finished: {
    endedAt: number;
    totalTurns: number;
    buildHash: string;
    replayArchiveAttempted: boolean;
  };
}

export type MatchTelemetryType = keyof MatchTelemetryPayloads;

export type MatchTelemetryEvent = {
  [K in MatchTelemetryType]: {
    schemaVersion: 1;
    type: K;
    matchId: string;
    sequence: number;
    observedAt: number;
    serverTick: number;
    payload: MatchTelemetryPayloads[K];
  };
}[MatchTelemetryType];

export interface MatchTelemetryCounters {
  observed: number;
  enqueued: number;
  sent: number;
  droppedDisabled: number;
  droppedCap: number;
  droppedEventBytes: number;
  droppedQueueCount: number;
  droppedQueueBytes: number;
  droppedSerialization: number;
  droppedDelivery: number;
  batchesSucceeded: number;
  batchesFailed: number;
}

export interface MatchTelemetryEmitter {
  emit(event: MatchTelemetryEvent): "enqueued" | "dropped";
  counters(): MatchTelemetryCounters;
  stop(): void;
}

export function zeroCounters(): MatchTelemetryCounters {
  return {
    observed: 0,
    enqueued: 0,
    sent: 0,
    droppedDisabled: 0,
    droppedCap: 0,
    droppedEventBytes: 0,
    droppedQueueCount: 0,
    droppedQueueBytes: 0,
    droppedSerialization: 0,
    droppedDelivery: 0,
    batchesSucceeded: 0,
    batchesFailed: 0,
  };
}

// Disabled telemetry: a stateless sink that drops every event and always
// reports zeroed counters. Holds no mutable state, so it is safe to share as
// a singleton across every game and test.
export const noopMatchTelemetryEmitter: MatchTelemetryEmitter = {
  emit: () => "dropped",
  counters: () => zeroCounters(),
  stop: () => undefined,
};
