export interface PublicGameModifiers {
  isCompact: boolean;
  isRandomSpawn: boolean;
  isCrowded: boolean;
  startingGold?: number;
}

export interface GameConfig {
  gameMap: string;
  gameType: string;
  gameMode: string;
  maxPlayers?: number;
  bots?: number;
  difficulty?: string;
  playerTeams?: number | string;
  gameMapSize?: string;
  publicGameModifiers?: PublicGameModifiers;
}

export interface PublicGameInfo {
  gameID: string;
  numClients: number;
  startsAt: number;
  gameConfig?: GameConfig;
}

export interface PublicGamesMessage {
  serverTime: number;
  games: PublicGameInfo[];
}

export interface GameInfoResponse {
  gameID: string;
  clients?: Array<{
    username: string;
    clientID: string;
  }>;
  lobbyCreatorClientID?: string;
  gameConfig?: GameConfig;
  startsAt?: number;
  serverTime: number;
}

export type LobbyOutcome =
  | "active"
  | "started"
  | "completed"
  | "did_not_start"
  | "unknown";

export interface LobbySnapshotPoint {
  at: number;
  serverTime: number;
  numClients: number;
  maxPlayers?: number;
}

export interface LobbyRecord {
  gameID: string;
  firstSeenAt: number;
  lastSeenAt: number;
  openedAt: number;
  scheduledStartAt: number;
  workerPath: string;
  gameConfig?: GameConfig;
  status: LobbyOutcome;
  closedAt?: number;
  startDetectedAt?: number;
  openDurationMs?: number;
  lastObservedClients: number;
  peakClients: number;
  troughClients: number;
  maxPlayers?: number;
  observedJoinEvents: number;
  observedLeaveEvents: number;
  snapshots: LobbySnapshotPoint[];
  fullMoments: number;
  fullDurationMs: number;
  fullLastSeenAt?: number;
  uniqueClientsObserved: number;
  uniqueClientIds: string[];
  gameInfoPolls: number;
  gameInfoPollErrors: number;
  probeAttempts: number;
  probeSuccessAt?: number;
  probeLastStatus?: number;
  playersAtStart?: number;
  fillRatioAtStart?: number;
  startedPollLastAt?: number;
  completedAt?: number;
  completionReason?: string;
  archiveFound: boolean;
  archivePlayers?: number;
  archiveDurationSec?: number;
  archiveWinner?: string;
  actualLobbyCreatedAt?: number;
  actualStartAt?: number;
  actualEndAt?: number;
  notes: string[];
}

export interface DbSchema {
  version: 1;
  createdAt: number;
  lastUpdatedAt: number;
  environment: {
    targetBaseUrl: string;
    targetWsUrl: string;
    archiveApiBase: string | null;
    numWorkers: number;
  };
  messagesReceived: number;
  reconnectCount: number;
  systemNotes: string[];
  lobbies: Record<string, LobbyRecord>;
}

export interface BucketStat {
  bucket: string;
  count: number;
  inProgress: number;
  completed: number;
  started: number;
  notStarted: number;
  avgOpenSec: number;
  avgJoinRatePerMin: number;
  avgFillAtClose: number;
  avgPlayersAtStart: number;
}

export interface TimelineBucket {
  minute: number;
  opened: number;
  closed: number;
  started: number;
}

export interface AnalyticsPayload {
  now: number;
  summary: {
    total: number;
    active: number;
    inProgress: number;
    completed: number;
    started: number;
    notStarted: number;
    unknown: number;
    underfilledStarted: number;
    avgOpenSec: number;
    avgJoinRatePerMin: number;
    avgPeakFillPct: number;
  };
  buckets: BucketStat[];
  timeline: TimelineBucket[];
  order: Array<{
    gameID: string;
    bucket: string;
    openedAt: number;
    closedAt?: number;
    startDetectedAt?: number;
    actualStartAt?: number;
    actualEndAt?: number;
    archiveDurationSec?: number;
    scheduledStartAt: number;
    peakClients: number;
    maxPlayers?: number;
    status: LobbyOutcome;
    openDurationMs?: number;
    joinRatePerMin: number;
  }>;
  interesting: {
    neverStarted: LobbyRecord[];
    lowFillStarted: LobbyRecord[];
    highChurn: LobbyRecord[];
  };
}

export type BucketMode =
  | "game_mode"
  | "game_mode_team"
  | "map"
  | "map_size"
  | "modifiers";

export function simpleHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    hash = (hash << 5) - hash + code;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function workerPathForGame(gameID: string, numWorkers: number): string {
  const index = simpleHash(gameID) % Math.max(1, numWorkers);
  return `w${index}`;
}

export function safeMaxPlayers(record: Pick<LobbyRecord, "maxPlayers">): number {
  return Math.max(1, record.maxPlayers ?? 1);
}

export function peakFillRatio(record: Pick<LobbyRecord, "peakClients" | "maxPlayers">): number {
  return record.peakClients / safeMaxPlayers(record as Pick<LobbyRecord, "maxPlayers">);
}

export function bucketForConfig(
  config: GameConfig | undefined,
  mode: BucketMode,
): string {
  if (!config) return "unknown";
  const modeName = (config.gameMode ?? "unknown").toLowerCase();
  const team = config.playerTeams ?? "none";
  const map = (config.gameMap ?? "unknown").toLowerCase();
  const mapSize = (config.gameMapSize ?? "unknown").toLowerCase();
  const modifiers = config.publicGameModifiers;
  const modifierParts = [
    modifiers?.isCompact ? "compact" : null,
    modifiers?.isRandomSpawn ? "random-spawn" : null,
    modifiers?.isCrowded ? "crowded" : null,
    modifiers?.startingGold ? `start-gold-${modifiers.startingGold}` : null,
  ].filter((entry): entry is string => entry !== null);

  switch (mode) {
    case "game_mode":
      return modeName;
    case "game_mode_team":
      return `${modeName}|team:${team}`;
    case "map":
      return map;
    case "map_size":
      return `${mapSize}|${modeName}`;
    case "modifiers":
      return modifierParts.length > 0 ? modifierParts.join("+") : "default";
    default:
      return "unknown";
  }
}

export function joinRatePerMinute(record: LobbyRecord): number {
  const closedAt = record.closedAt ?? record.lastSeenAt;
  const durationMs = Math.max(1, closedAt - record.openedAt);
  return (record.observedJoinEvents * 60_000) / durationMs;
}
