import type BetterSqlite3 from "better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import { Logger } from "winston";
import {
  RankedMatchHistoryEntry,
  RankedMatchInfo,
  RankedMatchState,
  RankedMode,
  RankedParticipantResultUpdate,
  RankedPlayerRating,
  RankedQueueTicket,
  RankedRatingHistoryEntry,
  RankedRegion,
  RankedTicketState,
} from "./types";

interface RankedQueueRow {
  id: string;
  player_id: string;
  mode_id: string;
  region: string;
  mmr_snapshot: number | null;
  ping_ms: number | null;
  created_at: number;
  updated_at: number;
  state: string;
  search_json: string | null;
  match_id: string | null;
  accept_token: string | null;
  accept_deadline: number | null;
  accepted_at: number | null;
}

interface RankedMatchRow {
  id: string;
  season_id: number | null;
  mode_id: string;
  region: string;
  map_id: string | null;
  game_id: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  state: string;
  average_mmr: number | null;
  team_size: number;
}

interface RankedParticipantRow {
  match_id: string;
  player_id: string;
  team: number;
  rating_before: number | null;
  rd_before: number | null;
  volatility_before: number | null;
  rating_after: number | null;
  rd_after: number | null;
  volatility_after: number | null;
  outcome: string | null;
  dodged: number;
  left_early: number;
  duration_seconds: number | null;
}

interface RankedPlayerRatingRow {
  player_id: string;
  season_id: number;
  rating: number;
  rd: number;
  volatility: number;
  matches_played: number;
  wins: number;
  losses: number;
  streak: number;
  last_active_at: number | null;
  last_match_id: string | null;
  username: string | null;
}

interface RankedMatchHistoryRow {
  match_id: string;
  game_id: string | null;
  created_at: number;
  finished_at: number | null;
  mode_id: string;
  region: string;
  outcome: string | null;
  rating_before: number | null;
  rating_after: number | null;
  opponent_player_id: string | null;
}

const DEFAULT_SEASON_NAME = "Season 1";
const MILLISECONDS_IN_DAY = 24 * 60 * 60 * 1000;
const TEN_YEARS_IN_MS = 10 * 365 * MILLISECONDS_IN_DAY;

export class RankedRepository {
  static create(log: Logger): RankedRepository {
    const configuredPath = process.env.RANKED_SQLITE_PATH?.trim();
    const resolvedPath =
      configuredPath && configuredPath.length > 0
        ? path.resolve(configuredPath)
        : path.resolve(process.cwd(), "ranked.db");

    const db = new Database(resolvedPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const repository = new RankedRepository(log, db);
    repository.initializeSchema();
    return repository;
  }

  private constructor(
    private readonly log: Logger,
    private readonly db: BetterSqlite3.Database,
  ) {}

  private initializeSchema(): void {
    const schemaStatements = [
      `CREATE TABLE IF NOT EXISTS ranked_seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL,
        soft_reset_factor REAL NOT NULL DEFAULT 0.75,
        created_at INTEGER NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS player_ranked_ratings (
        player_id TEXT NOT NULL,
        season_id INTEGER NOT NULL,
        rating REAL NOT NULL DEFAULT 1500,
        rd REAL NOT NULL DEFAULT 350,
        volatility REAL NOT NULL DEFAULT 0.06,
        matches_played INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0,
        last_active_at INTEGER,
        last_match_id TEXT,
        username TEXT,
        PRIMARY KEY (player_id, season_id),
        FOREIGN KEY (season_id) REFERENCES ranked_seasons(id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS ranked_matches (
        id TEXT PRIMARY KEY,
        season_id INTEGER,
        mode_id TEXT NOT NULL,
        region TEXT NOT NULL,
        map_id TEXT,
        game_id TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        state TEXT NOT NULL,
        average_mmr REAL,
        team_size INTEGER NOT NULL,
        FOREIGN KEY (season_id) REFERENCES ranked_seasons(id) ON DELETE SET NULL
      );`,
      `CREATE TABLE IF NOT EXISTS ranked_match_participants (
        match_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        team INTEGER NOT NULL,
        rating_before REAL,
        rd_before REAL,
        volatility_before REAL,
        rating_after REAL,
        rd_after REAL,
        volatility_after REAL,
        outcome TEXT,
        dodged INTEGER NOT NULL DEFAULT 0,
        left_early INTEGER NOT NULL DEFAULT 0,
        duration_seconds INTEGER,
        PRIMARY KEY (match_id, player_id),
        FOREIGN KEY (match_id) REFERENCES ranked_matches(id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS ranked_rating_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL,
        season_id INTEGER NOT NULL,
        match_id TEXT,
        delta REAL NOT NULL,
        rating_after REAL NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (season_id) REFERENCES ranked_seasons(id) ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS ranked_queue_tickets (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        is_party INTEGER NOT NULL DEFAULT 0,
        party_id TEXT,
        season_id INTEGER,
        mode_id TEXT NOT NULL,
        region TEXT NOT NULL,
        mmr_snapshot REAL,
        ping_ms INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        state TEXT NOT NULL,
        search_json TEXT,
        match_id TEXT,
        accept_token TEXT,
        accept_deadline INTEGER,
        accepted_at INTEGER,
        FOREIGN KEY (season_id) REFERENCES ranked_seasons(id) ON DELETE SET NULL
      );`,
      `CREATE INDEX IF NOT EXISTS ranked_matches_season_idx ON ranked_matches (season_id, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS ranked_match_participants_player_idx ON ranked_match_participants (player_id, match_id);`,
      `CREATE INDEX IF NOT EXISTS ranked_queue_tickets_state_idx ON ranked_queue_tickets (state, region, mode_id, created_at);`,
    ];

    const applySchema = this.db.transaction(() => {
      for (const statement of schemaStatements) {
        this.db.prepare(statement).run();
      }

      // Migration: Add game_id column if it doesn't exist
      try {
        const tableInfo = this.db
          .prepare("PRAGMA table_info(ranked_matches)")
          .all() as Array<{ name: string }>;
        const hasGameId = tableInfo.some((col) => col.name === "game_id");
        if (!hasGameId) {
          this.db
            .prepare("ALTER TABLE ranked_matches ADD COLUMN game_id TEXT")
            .run();
          this.log.info(
            "Migration: Added game_id column to ranked_matches table",
          );
        }
      } catch (error) {
        this.log.warn("Failed to check or add game_id column", { error });
      }

      // Migration: Add username column if it doesn't exist
      try {
        const ratingsTableInfo = this.db
          .prepare("PRAGMA table_info(player_ranked_ratings)")
          .all() as Array<{ name: string }>;
        const hasUsername = ratingsTableInfo.some(
          (col) => col.name === "username",
        );
        if (!hasUsername) {
          this.db
            .prepare(
              "ALTER TABLE player_ranked_ratings ADD COLUMN username TEXT",
            )
            .run();
          this.log.info(
            "Migration: Added username column to player_ranked_ratings table",
          );
        }
      } catch (error) {
        this.log.warn("Failed to check or add username column", { error });
      }

      const seasonCount = this.db
        .prepare("SELECT COUNT(1) as count FROM ranked_seasons")
        .get() as { count: number };
      if (!seasonCount || seasonCount.count === 0) {
        const now = Date.now();
        const startAt = now - 7 * MILLISECONDS_IN_DAY;
        const endAt = now + TEN_YEARS_IN_MS;
        this.db
          .prepare(
            `INSERT INTO ranked_seasons (name, start_at, end_at, soft_reset_factor, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(DEFAULT_SEASON_NAME, startAt, endAt, 0.75, now);
      }
    });

    applySchema();
  }

  async loadActiveQueueTickets(): Promise<RankedQueueTicket[]> {
    try {
      const rows = this.db
        .prepare(
          `SELECT id, player_id, mode_id, region, mmr_snapshot, ping_ms, created_at, updated_at, state, search_json,
                  match_id, accept_token, accept_deadline, accepted_at
           FROM ranked_queue_tickets
           WHERE state IN ('queued', 'matched')`,
        )
        .all() as RankedQueueRow[];

      const matchGroups = new Map<string, string[]>();
      for (const row of rows) {
        if (row.match_id) {
          const list = matchGroups.get(row.match_id) ?? [];
          list.push(row.id);
          matchGroups.set(row.match_id, list);
        }
      }

      return rows.map((row) =>
        this.mapRowToTicket(row, matchGroups.get(row.match_id ?? "")),
      );
    } catch (error) {
      this.log.error("Failed to load ranked queue tickets", { error });
      return [];
    }
  }

  async saveQueueTicket(ticket: RankedQueueTicket): Promise<void> {
    try {
      this.upsertQueueTicket(ticket);
    } catch (error) {
      this.log.error("Failed to persist ranked queue ticket", {
        ticketId: ticket.ticketId,
        error,
      });
    }
  }

  async saveQueueTickets(tickets: RankedQueueTicket[]): Promise<void> {
    const store = this.db.transaction((items: RankedQueueTicket[]) => {
      for (const ticket of items) {
        this.upsertQueueTicket(ticket);
      }
    });

    try {
      store(tickets);
    } catch (error) {
      this.log.error("Failed to persist ranked queue tickets", { error });
    }
  }

  async getActiveSeasonId(asOf: Date = new Date()): Promise<number | null> {
    try {
      const row = this.db
        .prepare(
          `SELECT id FROM ranked_seasons
           WHERE start_at <= ? AND end_at >= ?
           ORDER BY start_at DESC
           LIMIT 1`,
        )
        .get(asOf.getTime(), asOf.getTime()) as { id: number } | undefined;

      if (row) {
        return Number(row.id);
      }

      const fallback = this.db
        .prepare(`SELECT id FROM ranked_seasons ORDER BY start_at DESC LIMIT 1`)
        .get() as { id: number } | undefined;

      return fallback ? Number(fallback.id) : null;
    } catch (error) {
      this.log.error("Failed to determine active ranked season", { error });
      return null;
    }
  }

  async getLeaderboard(
    seasonId: number,
    limit = 25,
    offset = 0,
  ): Promise<RankedPlayerRating[]> {
    try {
      const safeLimit = Math.min(Math.max(limit, 1), 100);
      const safeOffset = Math.max(offset, 0);
      const rows = this.db
        .prepare(
          `SELECT *
           FROM player_ranked_ratings
           WHERE season_id = ?
           ORDER BY rating DESC
           LIMIT ? OFFSET ?`,
        )
        .all(seasonId, safeLimit, safeOffset) as RankedPlayerRatingRow[];

      return rows.map((row) => this.mapPlayerRatingRow(row));
    } catch (error) {
      this.log.error("Failed to load ranked leaderboard", { seasonId, error });
      return [];
    }
  }

  async getPlayerMatchHistory(
    playerId: string,
    seasonId: number,
    limit: number,
    offset: number,
  ): Promise<RankedMatchHistoryEntry[]> {
    try {
      const safeLimit = Math.min(Math.max(limit, 1), 100);
      const safeOffset = Math.max(offset, 0);
      const rows = this.db
        .prepare(
          `SELECT
             m.id AS match_id,
             m.game_id,
             m.created_at,
             m.finished_at,
             m.mode_id,
             m.region,
             p.outcome,
             p.rating_before,
             p.rating_after,
             opp.player_id AS opponent_player_id
           FROM ranked_match_participants p
           JOIN ranked_matches m ON m.id = p.match_id
           LEFT JOIN ranked_match_participants opp
             ON opp.match_id = p.match_id AND opp.player_id != p.player_id
           WHERE p.player_id = ? AND (m.season_id = ? OR m.season_id IS NULL)
           ORDER BY m.created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(
          playerId,
          seasonId,
          safeLimit,
          safeOffset,
        ) as RankedMatchHistoryRow[];

      return rows.map((row) => this.mapMatchHistoryRow(row));
    } catch (error) {
      this.log.error("Failed to load ranked match history", {
        playerId,
        seasonId,
        error,
      });
      return [];
    }
  }

  async isMatchAlreadyRated(matchId: string): Promise<boolean> {
    const row = this.db
      .prepare(
        `SELECT COUNT(1) as count FROM ranked_match_participants
         WHERE match_id = ? AND rating_after IS NOT NULL`,
      )
      .get(matchId) as { count: number } | undefined;
    return Boolean(row?.count && row.count > 0);
  }

  async getOrCreatePlayerRating(
    seasonId: number,
    playerId: string,
  ): Promise<RankedPlayerRating> {
    const existing = await this.getPlayerRating(seasonId, playerId);
    if (existing) {
      return existing;
    }

    const defaultRating: RankedPlayerRating = {
      playerId,
      seasonId,
      rating: 1500,
      rd: 350,
      volatility: 0.06,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      streak: 0,
      lastActiveAt: null,
      lastMatchId: null,
    };

    await this.upsertPlayerRating(defaultRating);
    return defaultRating;
  }

  async getPlayerRating(
    seasonId: number,
    playerId: string,
  ): Promise<RankedPlayerRating | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM player_ranked_ratings WHERE season_id = ? AND player_id = ?`,
      )
      .get(seasonId, playerId) as RankedPlayerRatingRow | undefined;

    return row ? this.mapPlayerRatingRow(row) : null;
  }

  async upsertPlayerRating(rating: RankedPlayerRating): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO player_ranked_ratings (
           player_id, season_id, rating, rd, volatility, matches_played,
           wins, losses, streak, last_active_at, last_match_id, username
         ) VALUES (
           @player_id, @season_id, @rating, @rd, @volatility, @matches_played,
           @wins, @losses, @streak, @last_active_at, @last_match_id, @username
         )
         ON CONFLICT(player_id, season_id) DO UPDATE SET
           rating = excluded.rating,
           rd = excluded.rd,
           volatility = excluded.volatility,
           matches_played = excluded.matches_played,
           wins = excluded.wins,
           losses = excluded.losses,
           streak = excluded.streak,
           last_active_at = excluded.last_active_at,
           last_match_id = excluded.last_match_id,
           username = excluded.username`,
      )
      .run({
        player_id: rating.playerId,
        season_id: rating.seasonId,
        rating: rating.rating,
        rd: rating.rd,
        volatility: rating.volatility,
        matches_played: rating.matchesPlayed,
        wins: rating.wins,
        losses: rating.losses,
        streak: rating.streak,
        last_active_at: rating.lastActiveAt ?? null,
        last_match_id: rating.lastMatchId ?? null,
        username: rating.username ?? null,
      });
  }

  async insertRatingHistory(entry: RankedRatingHistoryEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO ranked_rating_history (
           player_id, season_id, match_id, delta, rating_after, reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.playerId,
        entry.seasonId,
        entry.matchId ?? null,
        entry.delta,
        entry.ratingAfter,
        entry.reason,
        Date.now(),
      );
  }

  async updateParticipantResult(
    update: RankedParticipantResultUpdate,
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE ranked_match_participants
         SET rating_before = ?,
             rd_before = ?,
             volatility_before = ?,
             rating_after = ?,
             rd_after = ?,
             volatility_after = ?,
             outcome = ?,
             duration_seconds = COALESCE(?, duration_seconds)
         WHERE match_id = ? AND player_id = ?`,
      )
      .run(
        update.ratingBefore,
        update.rdBefore,
        update.volatilityBefore,
        update.ratingAfter,
        update.rdAfter,
        update.volatilityAfter,
        update.outcome,
        update.durationSeconds ?? null,
        update.matchId,
        update.playerId,
      );
  }

  async deleteQueueTicket(ticketId: string): Promise<void> {
    this.db
      .prepare(`DELETE FROM ranked_queue_tickets WHERE id = ?`)
      .run(ticketId);
  }

  async saveMatch(
    match: RankedMatchInfo,
    state: RankedMatchState,
    averageMmr?: number,
  ): Promise<void> {
    const existing = this.db
      .prepare(`SELECT * FROM ranked_matches WHERE id = ?`)
      .get(match.matchId) as RankedMatchRow | undefined;

    const now = Date.now();
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO ranked_matches (
             id, season_id, mode_id, region, map_id, game_id, created_at, started_at, finished_at,
             state, average_mmr, team_size
           ) VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, ?)`,
        )
        .run(
          match.matchId,
          match.seasonId ?? null,
          match.mode,
          match.region,
          match.createdAt,
          state,
          averageMmr ?? null,
          Math.max(match.tickets.length / 2, 1),
        );
      return;
    }

    const startedAt =
      state === "ready" && existing.started_at === null
        ? now
        : existing.started_at;
    const finishedAt =
      state === "completed" && existing.finished_at === null
        ? now
        : existing.finished_at;

    this.db
      .prepare(
        `UPDATE ranked_matches
         SET state = ?,
             average_mmr = ?,
             season_id = COALESCE(?, season_id),
             game_id = COALESCE(?, game_id),
             started_at = ?,
             finished_at = ?,
             team_size = ?
         WHERE id = ?`,
      )
      .run(
        state,
        averageMmr ?? null,
        match.seasonId ?? null,
        match.gameId ?? null,
        startedAt,
        finishedAt,
        Math.max(match.tickets.length / 2, 1),
        match.matchId,
      );
  }

  async saveParticipants(
    matchId: string,
    participants: RankedQueueTicket[],
  ): Promise<void> {
    const statement = this.db.prepare(
      `INSERT INTO ranked_match_participants (
         match_id, player_id, team, rating_before, rd_before, volatility_before,
         rating_after, rd_after, volatility_after, outcome, dodged, left_early, duration_seconds
       ) VALUES (
         @match_id, @player_id, @team, NULL, NULL, NULL, NULL, NULL, NULL, @outcome, 0, 0, NULL
       )
       ON CONFLICT(match_id, player_id) DO UPDATE SET
         team = excluded.team,
         outcome = excluded.outcome`,
    );

    const insertAll = this.db.transaction((items: RankedQueueTicket[]) => {
      items.forEach((ticket, index) => {
        statement.run({
          match_id: matchId,
          player_id: ticket.playerId,
          team: index % 2,
          outcome: "pending",
        });
      });
    });

    insertAll(participants);
  }

  private upsertQueueTicket(ticket: RankedQueueTicket): void {
    const updatedAt = ticket.updatedAt ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO ranked_queue_tickets (
           id, player_id, mode_id, region, mmr_snapshot, ping_ms, created_at, updated_at, state,
           search_json, match_id, accept_token, accept_deadline, accepted_at
         ) VALUES (
           @id, @player_id, @mode_id, @region, @mmr_snapshot, NULL, @created_at, @updated_at, @state,
           @search_json, @match_id, @accept_token, @accept_deadline, @accepted_at
         )
         ON CONFLICT(id) DO UPDATE SET
           player_id = excluded.player_id,
           mode_id = excluded.mode_id,
           region = excluded.region,
           mmr_snapshot = excluded.mmr_snapshot,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           state = excluded.state,
           search_json = excluded.search_json,
           match_id = excluded.match_id,
           accept_token = excluded.accept_token,
           accept_deadline = excluded.accept_deadline,
           accepted_at = excluded.accepted_at`,
      )
      .run({
        id: ticket.ticketId,
        player_id: ticket.playerId,
        mode_id: ticket.mode,
        region: ticket.region,
        mmr_snapshot: ticket.mmr ?? null,
        created_at: ticket.joinedAt,
        updated_at: updatedAt,
        state: ticket.state,
        search_json: "{}",
        match_id: ticket.match?.matchId ?? null,
        accept_token: ticket.acceptToken ?? null,
        accept_deadline: ticket.match?.acceptDeadline ?? null,
        accepted_at: ticket.acceptedAt ?? null,
      });
  }
  async markParticipantOutcome(
    matchId: string,
    playerId: string,
    outcome: "win" | "loss" | "draw",
  ): Promise<void> {
    try {
      this.db
        .prepare(
          `UPDATE ranked_match_participants
           SET outcome = ?
           WHERE match_id = ? AND player_id = ?`,
        )
        .run(outcome, matchId, playerId);
    } catch (error) {
      this.log.error("Failed to update participant outcome", {
        matchId,
        playerId,
        outcome,
        error,
      });
    }
  }
  mapMatchHistoryRow(row: RankedMatchHistoryRow): RankedMatchHistoryEntry {
    const ratingBefore =
      row.rating_before !== null ? Number(row.rating_before) : null;
    const ratingAfter =
      row.rating_after !== null ? Number(row.rating_after) : null;
    const ratingDelta =
      ratingBefore !== null && ratingAfter !== null
        ? Math.round((ratingAfter - ratingBefore) * 100) / 100
        : null;

    let outcome: RankedMatchHistoryEntry["outcome"] | undefined;
    if (
      row.outcome === "win" ||
      row.outcome === "loss" ||
      row.outcome === "draw" ||
      row.outcome === "pending"
    ) {
      outcome = row.outcome;
    }

    return {
      matchId: row.match_id,
      gameId: row.game_id ?? null,
      createdAt: row.created_at,
      finishedAt: row.finished_at ?? null,
      mode: row.mode_id as RankedMode,
      region: row.region as RankedRegion,
      outcome,
      ratingBefore,
      ratingAfter,
      ratingDelta,
      opponentPlayerId: row.opponent_player_id ?? null,
    };
  }

  private mapPlayerRatingRow(row: RankedPlayerRatingRow): RankedPlayerRating {
    return {
      playerId: row.player_id,
      seasonId: Number(row.season_id),
      rating: Number(row.rating),
      rd: Number(row.rd),
      volatility: Number(row.volatility),
      matchesPlayed: Number(row.matches_played),
      wins: Number(row.wins),
      losses: Number(row.losses),
      streak: Number(row.streak),
      lastActiveAt: row.last_active_at ?? null,
      lastMatchId: row.last_match_id ?? null,
      username: row.username ?? null,
    };
  }

  private mapRowToTicket(
    row: RankedQueueRow,
    matchTickets?: string[],
  ): RankedQueueTicket {
    const ticket: RankedQueueTicket = {
      ticketId: row.id,
      playerId: row.player_id,
      mode: row.mode_id as RankedMode,
      region: row.region as RankedRegion,
      mmr: row.mmr_snapshot ?? undefined,
      state: row.state as RankedTicketState,
      joinedAt: row.created_at,
      updatedAt: row.updated_at,
      acceptToken: row.accept_token ?? undefined,
      acceptedAt: row.accepted_at ?? undefined,
    };

    if (row.match_id) {
      const state: RankedMatchState =
        row.state === "matched" ? "awaiting_accept" : "ready";
      ticket.match = {
        matchId: row.match_id,
        createdAt: row.created_at,
        mode: ticket.mode,
        region: ticket.region,
        tickets: matchTickets ?? [row.id],
        state,
        acceptDeadline: row.accept_deadline ?? undefined,
      };
    }

    return ticket;
  }
}
