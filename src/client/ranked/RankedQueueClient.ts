import { getServerConfigFromClient } from "../../core/configuration/ConfigLoader";
import { GameID } from "../../core/Schemas";
import {
  RankedMode,
  RankedQueueTicket,
  RankedRegion,
} from "../../server/ranked/types";
import { getAuthHeader } from "../jwt";

interface RankedQueueJoinResponse {
  ticket: RankedQueueTicket;
}

interface RankedQueueGetResponse {
  ticket: RankedQueueTicket;
}

interface RankedMatchActionResponse {
  ticket: RankedQueueTicket;
}

export interface RankedLeaderboardEntry {
  rank: number;
  playerId: string;
  rating: number;
  rd: number;
  volatility: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  streak: number;
  lastActiveAt?: number | null;
  lastMatchId?: string | null;
  username?: string;
}

interface RankedLeaderboardResponse {
  seasonId: number | null;
  entries: RankedLeaderboardEntry[];
}

export interface RankedMatchHistoryEntry {
  matchId: string;
  gameId?: string | null;
  createdAt: number;
  finishedAt: number | null;
  mode: RankedMode;
  region: RankedRegion;
  outcome?: "win" | "loss" | "draw" | "pending";
  ratingBefore?: number | null;
  ratingAfter?: number | null;
  ratingDelta?: number | null;
  opponentPlayerId?: string | null;
}

interface RankedHistoryResponse {
  seasonId: number | null;
  matches: RankedMatchHistoryEntry[];
}

const RANKED_QUEUE_WORKER_KEY: GameID = "ranked-queue"; // ensure ranked requests share the same worker

export async function joinRankedQueue(
  playerId: string,
  mode: RankedMode = RankedMode.Duel,
  region: RankedRegion = RankedRegion.Global,
  mmr?: number,
  username?: string,
): Promise<RankedQueueTicket> {
  const config = await getServerConfigFromClient();
  const workerPath = config.workerPath(RANKED_QUEUE_WORKER_KEY);
  const authHeader = getAuthHeader();
  if (!authHeader) {
    throw new Error("Missing authentication for ranked queue request");
  }
  const response = await fetch(`/${workerPath}/api/ranked/queue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({ playerId, mode, region, mmr, username }),
  });

  if (!response.ok) {
    const error = await safeReadText(response);
    throw new Error(`Failed to join ranked queue: ${response.status} ${error}`);
  }

  const body = (await response.json()) as RankedQueueJoinResponse;
  return body.ticket;
}

export async function getRankedTicket(
  playerId: string,
  ticketId: string,
): Promise<RankedQueueTicket> {
  const config = await getServerConfigFromClient();
  const workerPath = config.workerPath(RANKED_QUEUE_WORKER_KEY);
  const authHeader = getAuthHeader();
  if (!authHeader) {
    throw new Error("Missing authentication for ranked queue request");
  }
  const response = await fetch(`/${workerPath}/api/ranked/queue/${ticketId}`, {
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    const error = await safeReadText(response);
    throw new Error(
      `Failed to load ranked ticket: ${response.status} ${error}`,
    );
  }

  const body = (await response.json()) as RankedQueueGetResponse;
  return body.ticket;
}

export async function leaveRankedQueue(
  playerId: string,
  ticketId: string,
): Promise<void> {
  const config = await getServerConfigFromClient();
  const workerPath = config.workerPath(RANKED_QUEUE_WORKER_KEY);
  const authHeader = getAuthHeader();
  if (!authHeader) {
    throw new Error("Missing authentication for ranked queue request");
  }
  const response = await fetch(`/${workerPath}/api/ranked/queue/${ticketId}`, {
    method: "DELETE",
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok && response.status !== 404) {
    const error = await safeReadText(response);
    throw new Error(
      `Failed to leave ranked queue: ${response.status} ${error}`,
    );
  }
}

export async function acceptRankedMatch(
  playerId: string,
  matchId: string,
  ticketId: string,
  acceptToken: string,
): Promise<RankedQueueTicket> {
  const config = await getServerConfigFromClient();
  const workerPath = config.workerPath(RANKED_QUEUE_WORKER_KEY);
  const authHeader = getAuthHeader();
  if (!authHeader) {
    throw new Error("Missing authentication for ranked queue request");
  }
  const response = await fetch(
    `/${workerPath}/api/ranked/match/${matchId}/accept`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ playerId, ticketId, acceptToken }),
    },
  );

  if (!response.ok) {
    const error = await safeReadText(response);
    throw new Error(
      `Failed to accept ranked match: ${response.status} ${error}`,
    );
  }

  const body = (await response.json()) as RankedMatchActionResponse;
  return body.ticket;
}

export async function declineRankedMatch(
  playerId: string,
  matchId: string,
  ticketId: string,
): Promise<RankedQueueTicket> {
  const config = await getServerConfigFromClient();
  const workerPath = config.workerPath(RANKED_QUEUE_WORKER_KEY);
  const authHeader = getAuthHeader();
  if (!authHeader) {
    throw new Error("Missing authentication for ranked queue request");
  }
  const response = await fetch(
    `/${workerPath}/api/ranked/match/${matchId}/decline`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ playerId, ticketId }),
    },
  );

  if (!response.ok) {
    const error = await safeReadText(response);
    throw new Error(
      `Failed to decline ranked match: ${response.status} ${error}`,
    );
  }

  const body = (await response.json()) as RankedMatchActionResponse;
  return body.ticket;
}

export async function fetchRankedLeaderboard(
  playerId: string,
  options: { limit?: number; offset?: number; seasonId?: number } = {},
): Promise<RankedLeaderboardResponse> {
  const config = await getServerConfigFromClient();
  const workerPath = config.workerPath(RANKED_QUEUE_WORKER_KEY);
  const authHeader = getAuthHeader();
  if (!authHeader) {
    throw new Error("Missing authentication for ranked queue request");
  }

  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.seasonId !== undefined) {
    params.set("seasonId", String(options.seasonId));
  }

  const query = params.toString();
  const url =
    query.length > 0
      ? `/${workerPath}/api/ranked/leaderboard?${query}`
      : `/${workerPath}/api/ranked/leaderboard`;

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    const error = await safeReadText(response);
    throw new Error(
      `Failed to load ranked leaderboard: ${response.status} ${error}`,
    );
  }

  return (await response.json()) as RankedLeaderboardResponse;
}

export async function fetchRankedHistory(
  playerId: string,
  options: { limit?: number; offset?: number; seasonId?: number } = {},
): Promise<RankedHistoryResponse> {
  const config = await getServerConfigFromClient();
  const workerPath = config.workerPath(RANKED_QUEUE_WORKER_KEY);
  const authHeader = getAuthHeader();
  if (!authHeader) {
    throw new Error("Missing authentication for ranked queue request");
  }

  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.seasonId !== undefined) {
    params.set("seasonId", String(options.seasonId));
  }

  const query = params.toString();
  const url =
    query.length > 0
      ? `/${workerPath}/api/ranked/history?${query}`
      : `/${workerPath}/api/ranked/history`;

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    const error = await safeReadText(response);
    throw new Error(
      `Failed to load ranked match history: ${response.status} ${error}`,
    );
  }

  return (await response.json()) as RankedHistoryResponse;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `${error}`;
  }
}

export type { RankedQueueTicket };
