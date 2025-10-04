// Ranked enums kept intentionally minimal for the MVP implementation.
export enum RankedMode {
  Duel = "1v1",
}

export enum RankedRegion {
  Global = "global",
}

export type RankedTicketState =
  | "queued"
  | "matched"
  | "ready"
  | "cancelled"
  | "completed";
export type RankedMatchState =
  | "awaiting_accept"
  | "ready"
  | "cancelled"
  | "completed";

export interface RankedQueueJoinRequest {
  playerId: string;
  mode: RankedMode;
  region: RankedRegion;
  mmr?: number | null;
  username?: string;
}

export interface RankedMatchInfo {
  matchId: string;
  createdAt: number;
  mode: RankedMode;
  region: RankedRegion;
  tickets: string[];
  acceptedCount?: number;
  totalPlayers?: number;
  state: RankedMatchState;
  acceptDeadline?: number;
  gameId?: string;
  seasonId?: number;
}

export interface RankedQueueTicket {
  ticketId: string;
  playerId: string;
  mode: RankedMode;
  region: RankedRegion;
  mmr?: number | null;
  state: RankedTicketState;
  joinedAt: number;
  updatedAt: number;
  match?: RankedMatchInfo;
  acceptToken?: string;
  acceptedAt?: number;
  dodgePenaltyUntil?: number;
}

export type RankedTicketView = RankedQueueTicket;
export interface RankedPlayerRating {
  playerId: string;
  seasonId: number;
  rating: number;
  rd: number;
  volatility: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  streak: number;
  lastActiveAt?: number | null;
  lastMatchId?: string | null;
  username?: string | null;
}

export interface RankedRatingHistoryEntry {
  playerId: string;
  seasonId: number;
  matchId: string | null;
  delta: number;
  ratingAfter: number;
  reason: string;
}

export interface RankedLeaderboardEntry extends RankedPlayerRating {
  rank: number;
  username?: string;
}

export interface RankedMatchHistoryEntry {
  matchId: string;
  gameId?: string | null;
  finishedAt: number | null;
  createdAt: number;
  mode: RankedMode;
  region: RankedRegion;
  outcome?: "win" | "loss" | "draw" | "pending";
  ratingBefore?: number | null;
  ratingAfter?: number | null;
  ratingDelta?: number | null;
  opponentPlayerId?: string | null;
}

export interface RankedParticipantResultUpdate {
  matchId: string;
  playerId: string;
  ratingBefore: number;
  rdBefore: number;
  volatilityBefore: number;
  ratingAfter: number;
  rdAfter: number;
  volatilityAfter: number;
  outcome: "win" | "loss" | "draw";
  durationSeconds?: number | null;
}
