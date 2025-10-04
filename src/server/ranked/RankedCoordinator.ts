import { IncomingMessage } from "http";
import { Logger } from "winston";
import WebSocket from "ws";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../core/game/Game";
import { GameConfig } from "../../core/Schemas";
import { generateID } from "../../core/Util";
import { getRedisClient } from "../db/RedisClient";
import { GameManager } from "../GameManager";
import { GameMatchResult, GameServer } from "../GameServer";
import { AcceptCoordinator, AcceptMatchState } from "./AcceptCoordinator";
import { RankedQueueService } from "./RankedQueueService";
import { RankedRepository } from "./RankedRepository";
import { RankedTelemetry } from "./RankedTelemetry";
import {
  MatchRatingSummary,
  RatingParticipantInput,
  RatingService,
} from "./RatingService";
import {
  RankedMatchState,
  RankedMode,
  RankedQueueJoinRequest,
  RankedQueueTicket,
  RankedRegion,
  RankedTicketView,
} from "./types";

interface RankedWebSocketClient {
  ws: WebSocket;
  playerId: string | null;
  subscribedTickets: Set<string>;
}

export class RankedCoordinator {
  private readonly queue: RankedQueueService;
  private readonly acceptCoordinator: AcceptCoordinator;
  private readonly ratingService: RatingService;
  private readonly telemetry: RankedTelemetry;
  private readonly acceptWindowMs = 12_000;
  private readonly activeGames = new Map<
    string,
    { matchId: string; tickets: RankedQueueTicket[] }
  >();
  private readonly wsClients = new Map<WebSocket, RankedWebSocketClient>();

  constructor(
    private readonly gameManager: GameManager,
    private readonly log: Logger,
    private readonly repository: RankedRepository | null = null,
  ) {
    this.queue = new RankedQueueService(
      this.log.child({ comp: "ranked_queue" }),
      (tickets) => this.onMatchReady(tickets),
    );
    this.acceptCoordinator = new AcceptCoordinator(
      async (match) => {
        await this.finalizeMatch(match);
      },
      async (match, declining) => {
        await this.handleMatchDeclined(match, declining);
      },
      this.log.child({ comp: "ranked_accept" }),
    );

    this.ratingService = new RatingService(
      this.log.child({ comp: "ranked_rating" }),
      this.repository,
    );

    // Initialize telemetry with Redis if available
    const redis = getRedisClient();
    this.telemetry = new RankedTelemetry(redis);

    if (redis) {
      this.log.info("Ranked telemetry enabled with Redis");
    } else {
      this.log.info("Ranked telemetry disabled (no Redis connection)");
    }

    this.gameManager.onGameFinished((game) => {
      void this.handleRankedGameFinished(game);
    });

    // Clean up stuck/old tickets every 5 minutes
    setInterval(() => {
      void this.cleanupStaleTickets();
    }, 300_000);

    // Clean up orphaned active games every minute
    setInterval(() => {
      void this.cleanupOrphanedGames();
    }, 60_000);
  }

  /**
   * Clean up games that have been in "ready" state for too long
   * or where the game has finished but we missed the event
   */
  private async cleanupOrphanedGames(): Promise<void> {
    const now = Date.now();
    const maxGameDuration = 3 * 60 * 60 * 1000; // 3 hours
    const staleReadyThreshold = 10 * 60 * 1000; // 10 minutes

    for (const [gameId, active] of this.activeGames.entries()) {
      const game = this.gameManager.game(gameId);

      // Case 1: Game doesn't exist in GameManager anymore
      if (!game) {
        this.log.warn("Cleaning up orphaned ranked game (game not found)", {
          gameId,
          matchId: active.matchId,
          ticketCount: active.tickets.length,
        });

        // Mark as cancelled and clean up
        await this.finalizeOrphanedMatch(
          active.matchId,
          active.tickets,
          "game_not_found",
        );
        this.activeGames.delete(gameId);
        continue;
      }

      // Case 2: Game has been running for too long
      const gameAge = now - game.createdAt;
      if (gameAge > maxGameDuration) {
        this.log.warn("Cleaning up ranked game that exceeded max duration", {
          gameId,
          matchId: active.matchId,
          ageMs: gameAge,
        });

        const result = game.getMatchResult();
        if (result) {
          await this.processMatchResult(active, game, result);
        } else {
          await this.finalizeOrphanedMatch(
            active.matchId,
            active.tickets,
            "timeout",
          );
        }
        this.activeGames.delete(gameId);
        continue;
      }

      // Case 3: Game is in finished phase but we haven't processed it
      if (game.phase() === "FINISHED") {
        this.log.info("Processing finished game that wasn't caught by event", {
          gameId,
          matchId: active.matchId,
        });

        const result = game.getMatchResult();
        if (result) {
          await this.processMatchResult(active, game, result);
        } else {
          await this.finalizeOrphanedMatch(
            active.matchId,
            active.tickets,
            "no_result",
          );
        }
        this.activeGames.delete(gameId);
        continue;
      }
    }
  }

  /**
   * Process match result (extracted for reuse)
   */
  private async processMatchResult(
    active: { matchId: string; tickets: RankedQueueTicket[] },
    game: GameServer,
    result: GameMatchResult,
  ): Promise<void> {
    const now = Date.now();
    const completedTickets = this.queue.completeMatch(active.matchId);
    const tickets =
      completedTickets.length > 0 ? completedTickets : active.tickets;

    if (tickets.length === 0) {
      this.log.warn("Ranked match finished without tickets", {
        matchId: active.matchId,
        gameId: game.id,
      });
      return;
    }

    // Update ticket states
    tickets.forEach((ticket) => {
      ticket.state = "completed";
      ticket.updatedAt = now;
      if (ticket.match) {
        ticket.match = {
          ...ticket.match,
          state: "completed" as RankedMatchState,
          gameId: game.id,
        };
      }
    });

    // Extract winner player IDs
    const winnerPlayerIds: string[] = [];
    if (result.winner && result.winner[0] === "player") {
      const winnerClientID = result.winner[1];
      const winnerSummary = result.players.find(
        (p) => p.clientID === winnerClientID,
      );
      if (winnerSummary?.persistentID) {
        winnerPlayerIds.push(winnerSummary.persistentID);
      }
    }

    // Record ratings
    let ratingSummary: MatchRatingSummary | null = null;
    if (this.ratingService && tickets.length >= 2) {
      try {
        const mode = tickets[0]?.mode ?? RankedMode.Duel;
        const region = tickets[0]?.region ?? RankedRegion.Global;
        ratingSummary = await this.ratingService.recordMatch({
          matchId: active.matchId,
          gameId: game.id,
          finishedAt: now,
          mode,
          region,
          participants: result.players.map((p) => ({
            playerId: p.persistentID,
            clientId: p.clientID,
            persistentId: p.persistentID,
          })),
          winnerPlayerIds,
        });
      } catch (error) {
        this.log.error("failed to record ranked match ratings", {
          error,
          matchId: active.matchId,
          gameId: game.id,
        });
      }
    } else {
      this.log.warn("No match result captured for ranked game", {
        matchId: active.matchId,
        gameId: game.id,
      });
    }

    // Save to repository
    if (this.repository) {
      const mode = tickets[0]?.mode ?? RankedMode.Duel;
      const region = tickets[0]?.region ?? RankedRegion.Global;
      const ticketMatch = tickets[0]?.match;

      if (!ratingSummary) {
        const winnerSet = new Set(winnerPlayerIds);
        for (const ticket of tickets) {
          const outcome =
            winnerSet.size > 0
              ? winnerSet.has(ticket.playerId)
                ? "win"
                : "loss"
              : "loss";
          await this.repository.markParticipantOutcome(
            active.matchId,
            ticket.playerId,
            outcome,
          );
        }
      }

      const matchInfo = ticketMatch
        ? { ...ticketMatch }
        : {
            matchId: active.matchId,
            createdAt: now,
            mode,
            region,
            tickets: tickets.map((ticket) => ticket.ticketId),
            state: "completed" as RankedMatchState,
            acceptDeadline: undefined,
            gameId: game.id,
            seasonId: ratingSummary?.seasonId,
          };

      matchInfo.state = "completed";
      matchInfo.gameId = game.id;
      if (ratingSummary) {
        matchInfo.seasonId = ratingSummary.seasonId;
      }

      try {
        await this.repository.saveMatch(
          matchInfo,
          "completed",
          ratingSummary?.averageRatingBefore,
        );
        for (const ticket of tickets) {
          await this.repository.deleteQueueTicket(ticket.ticketId);
        }
      } catch (error) {
        this.log.error("failed to finalize ranked match", {
          error,
          gameId: game.id,
          matchId: active.matchId,
        });
      }
    }

    this.log.info("ranked match completed", {
      matchId: active.matchId,
      gameId: game.id,
      rated: Boolean(ratingSummary),
    });
  }

  /**
   * Finalize orphaned match without game result
   */
  private async finalizeOrphanedMatch(
    matchId: string,
    tickets: RankedQueueTicket[],
    reason: string,
  ): Promise<void> {
    const now = Date.now();

    // Mark tickets as cancelled
    tickets.forEach((ticket) => {
      ticket.state = "cancelled";
      ticket.updatedAt = now;
      if (ticket.match) {
        ticket.match.state = "cancelled";
      }
    });

    if (this.repository) {
      try {
        const mode = tickets[0]?.mode ?? RankedMode.Duel;
        const region = tickets[0]?.region ?? RankedRegion.Global;

        await this.repository.saveMatch(
          {
            matchId,
            createdAt: tickets[0]?.joinedAt ?? now,
            mode,
            region,
            tickets: tickets.map((t) => t.ticketId),
            state: "cancelled",
            acceptDeadline: undefined,
          },
          "cancelled",
          undefined,
        );

        for (const ticket of tickets) {
          await this.repository.deleteQueueTicket(ticket.ticketId);
          // Don't change ratings for cancelled matches
          await this.repository.markParticipantOutcome(
            matchId,
            ticket.playerId,
            "draw",
          );
        }
      } catch (error) {
        this.log.error("failed to finalize orphaned match", {
          error,
          matchId,
          reason,
        });
      }
    }

    // Remove from queue
    this.queue.completeMatch(matchId);

    this.log.warn("Finalized orphaned ranked match", {
      matchId,
      reason,
      ticketCount: tickets.length,
    });
  }

  private async cleanupStaleTickets(): Promise<void> {
    if (!this.repository) {
      return;
    }

    try {
      const now = Date.now();
      const staleThresholdMs = 3600_000; // 1 hour

      // Load all active tickets from DB
      const tickets = await this.repository.loadActiveQueueTickets();

      for (const ticket of tickets) {
        const age = now - ticket.updatedAt;

        // If ticket is stuck in matched or awaiting_accept for > 1 hour, cancel it
        if (age > staleThresholdMs) {
          if (
            ticket.state === "matched" ||
            ticket.match?.state === "awaiting_accept"
          ) {
            this.log.warn("Cleaning up stale ranked ticket", {
              ticketId: ticket.ticketId,
              playerId: ticket.playerId,
              state: ticket.state,
              matchState: ticket.match?.state,
              ageMs: age,
            });

            // Cancel the ticket
            this.queue.leave(ticket.ticketId);
            await this.repository.deleteQueueTicket(ticket.ticketId);
          }
        }
      }
    } catch (error) {
      this.log.error("Failed to cleanup stale tickets", { error });
    }
  }

  async initialize(): Promise<void> {
    if (!this.repository) {
      return;
    }

    try {
      // Clean up stale tickets on startup
      await this.cleanupStaleTickets();

      const persistedTickets = await this.repository.loadActiveQueueTickets();
      if (persistedTickets.length === 0) {
        return;
      }

      // Filter out tickets that are too old or in invalid states
      const now = Date.now();
      const validTickets = persistedTickets.filter((ticket) => {
        const age = now - ticket.updatedAt;
        // Don't restore tickets older than 5 minutes or in matched/awaiting states
        if (age > 300_000) {
          this.log.info("Skipping old ticket during restore", {
            ticketId: ticket.ticketId,
            ageMs: age,
          });
          void this.repository?.deleteQueueTicket(ticket.ticketId);
          return false;
        }
        if (
          ticket.state === "matched" ||
          ticket.match?.state === "awaiting_accept"
        ) {
          this.log.info("Skipping matched/awaiting ticket during restore", {
            ticketId: ticket.ticketId,
            state: ticket.state,
          });
          void this.repository?.deleteQueueTicket(ticket.ticketId);
          return false;
        }
        return ticket.state === "queued";
      });

      if (validTickets.length === 0) {
        return;
      }

      this.queue.restoreTickets(validTickets);

      // No need to restore awaiting matches since we filtered them out above
      this.queue.recalculateMatches();
      this.log.info("restored ranked queue state", {
        tickets: validTickets.length,
      });
    } catch (error) {
      this.log.error("failed to restore ranked queue state", { error });
    }
  }

  async join(request: RankedQueueJoinRequest): Promise<RankedTicketView> {
    // Check if player has an active dodge penalty
    const existingTicket = this.queue.get(request.playerId);
    if (existingTicket?.dodgePenaltyUntil) {
      const now = Date.now();
      if (now < existingTicket.dodgePenaltyUntil) {
        const remainingSeconds = Math.ceil(
          (existingTicket.dodgePenaltyUntil - now) / 1000,
        );
        this.log.info("Player attempted to join with active dodge penalty", {
          playerId: request.playerId,
          remainingSeconds,
        });
        throw new Error(
          `Dodge penalty active. Please wait ${remainingSeconds} seconds.`,
        );
      }
    }

    // Fetch player's current MMR if not provided
    let mmr = request.mmr ?? undefined;
    if (mmr === undefined || mmr === null) {
      if (this.repository) {
        try {
          const seasonId = await this.repository.getActiveSeasonId();
          if (seasonId !== null) {
            const rating = await this.repository.getPlayerRating(
              seasonId,
              request.playerId,
            );
            if (rating) {
              mmr = rating.rating;
            }
          }
        } catch (error) {
          this.log.warn("Failed to fetch player rating for queue join", {
            playerId: request.playerId,
            error,
          });
        }
      }
    }

    // Store username in rating if provided
    if (request.username && this.repository) {
      try {
        const seasonId = await this.repository.getActiveSeasonId();
        if (seasonId !== null) {
          const rating = await this.repository.getOrCreatePlayerRating(
            seasonId,
            request.playerId,
          );
          if (rating) {
            rating.username = request.username;
            await this.repository.upsertPlayerRating(rating);
            this.log.debug("Stored username for player", {
              playerId: request.playerId,
              username: request.username,
            });
          }
        }
      } catch (error) {
        this.log.warn("Failed to store username", {
          playerId: request.playerId,
          error,
        });
      }
    }

    const ticket = this.queue.join({ ...request, mmr });
    await this.persistTicket(ticket);

    // Track queue join in telemetry
    await this.telemetry.incrementQueued(request.mode, request.region);

    return this.cloneTicket(ticket);
  }

  async leave(ticketId: string): Promise<boolean> {
    const ticket = this.queue.get(ticketId);
    const removed = this.queue.leave(ticketId);
    if (!removed || !ticket) {
      return removed;
    }
    ticket.updatedAt = Date.now();
    await this.persistTicket(ticket);

    // Track queue leave in telemetry
    await this.telemetry.decrementQueued(ticket.mode, ticket.region);

    return true;
  }

  get(ticketId: string): RankedTicketView | undefined {
    const ticket = this.queue.get(ticketId);
    return ticket ? this.cloneTicket(ticket) : undefined;
  }

  async accept(
    matchId: string,
    ticketId: string,
    acceptToken: string,
  ): Promise<RankedTicketView | undefined> {
    const ticket = await this.acceptCoordinator.accept(
      matchId,
      ticketId,
      acceptToken,
    );
    if (!ticket) {
      return undefined;
    }
    ticket.updatedAt = Date.now();
    await this.persistTicket(ticket);

    // Broadcast to all players in the match that someone accepted
    if (ticket.match) {
      const match = this.acceptCoordinator.getMatch(matchId);
      if (match) {
        this.broadcastMatchUpdate(match.tickets);
      }
    }

    return this.cloneTicket(ticket);
  }

  async decline(
    matchId: string,
    ticketId: string,
  ): Promise<RankedTicketView | undefined> {
    const ticket = await this.acceptCoordinator.decline(matchId, ticketId);
    return ticket ? this.cloneTicket(ticket) : undefined;
  }

  private async onMatchReady(tickets: RankedQueueTicket[]): Promise<void> {
    if (tickets.length === 0) {
      return;
    }

    const match = tickets[0].match;
    if (!match) {
      this.log.warn("match callback without match info", {
        ticketIds: tickets.map((ticket) => ticket.ticketId),
      });
      return;
    }

    const acceptDeadline = Date.now() + this.acceptWindowMs;
    tickets.forEach((ticket) => {
      ticket.acceptToken = generateID();
      ticket.acceptedAt = undefined;
      ticket.updatedAt = Date.now();
      if (ticket.match) {
        ticket.match = {
          ...ticket.match,
          state: "awaiting_accept",
          acceptDeadline,
        };
      }
    });

    this.acceptCoordinator.register({
      matchId: match.matchId,
      tickets,
      acceptDeadline,
    });

    void this.persistTickets(tickets);
    this.broadcastMatchUpdate(tickets); // Notify clients immediately

    // Track match found in telemetry
    const mode = tickets[0]?.mode ?? RankedMode.Duel;
    const region = tickets[0]?.region ?? RankedRegion.Global;
    await this.telemetry.trackMatchFound(mode, region);

    // Decrement queue counters for matched players
    for (const ticket of tickets) {
      await this.telemetry.decrementQueued(ticket.mode, ticket.region);
    }

    this.log.info("ranked match awaiting accept", {
      matchId: match.matchId,
      tickets: match.tickets,
      acceptDeadline,
    });
  }

  private generateGameIdForCurrentWorker(): string {
    const workerId = parseInt(process.env.WORKER_ID ?? "0");
    const numWorkers = 2; // TODO: get from config

    // Try generating IDs until we find one that hashes to this worker
    for (let i = 0; i < 100; i++) {
      const gameId = generateID();
      const config = this.gameManager["config"]; // Access private config field
      if (config.workerIndex(gameId) === workerId) {
        return gameId;
      }
    }

    // Fallback: just use a random ID (will cause routing issues but at least won't hang)
    this.log.warn(
      "Failed to generate gameId for current worker, using random ID",
    );
    return generateID();
  }

  private async finalizeMatch(match: AcceptMatchState): Promise<void> {
    this.log.info("finalizeMatch called", {
      matchId: match.matchId,
      ticketCount: match.tickets.length,
    });

    const tickets = match.tickets;
    if (tickets.length === 0) {
      this.log.warn("finalizeMatch: no tickets");
      return;
    }

    const gameId = this.generateGameIdForCurrentWorker();
    this.log.info("Generated gameId for ranked match", {
      matchId: match.matchId,
      gameId,
      workerId: process.env.WORKER_ID,
    });
    const totalPlayers = match.tickets.length;
    const humanPlayers = tickets.length;
    const botsCount = Math.max(0, 4 - humanPlayers); // Fill up to 4 total players
    const rankedConfig: GameConfig = {
      gameMap: GameMapType.World,
      gameType: GameType.Private,
      gameMapSize: GameMapSize.Small,
      difficulty: Difficulty.Medium,
      disableNPCs: false, // Enable nations/NPCs
      donateGold: false,
      donateTroops: false,
      bots: botsCount,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      gameMode: GameMode.FFA,
      maxPlayers: humanPlayers, // Only count human players, not bots
      disabledUnits: [],
    };

    this.gameManager.createGame(gameId, rankedConfig);

    const updatedAt = Date.now();
    tickets.forEach((ticket) => {
      ticket.state = "ready";
      if (!ticket.match) {
        ticket.match = {
          matchId: match.matchId,
          createdAt: updatedAt,
          mode: ticket.mode,
          region: ticket.region,
          tickets: match.tickets.map((t) => t.ticketId),
          state: "ready",
          acceptDeadline: match.acceptDeadline,
          gameId,
          acceptedCount: totalPlayers,
          totalPlayers,
        };
      } else {
        ticket.match = {
          ...ticket.match,
          state: "ready",
          gameId,
          acceptedCount: totalPlayers,
          totalPlayers,
        };
      }
      ticket.acceptToken = undefined;
      ticket.acceptedAt = ticket.acceptedAt ?? updatedAt;
      ticket.updatedAt = updatedAt;
    });

    await this.persistTickets(tickets);
    this.broadcastMatchUpdate(tickets); // Notify clients game is ready

    if (this.repository) {
      try {
        const matchInfo = tickets[0]?.match;
        if (matchInfo) {
          if (matchInfo.seasonId === undefined) {
            const seasonId = await this.repository.getActiveSeasonId();
            if (seasonId !== null) {
              matchInfo.seasonId = seasonId;
              for (const ticket of tickets) {
                if (ticket.match) {
                  ticket.match.seasonId = seasonId;
                }
              }
            }
          }

          this.log.info("Saving match to database", {
            matchId: matchInfo.matchId,
            gameId: matchInfo.gameId,
          });
          await this.repository.saveMatch(matchInfo, "ready");
          await this.repository.saveParticipants(match.matchId, tickets);
        }
      } catch (error) {
        this.log.error("failed to persist ranked match state", {
          error,
          matchId: match.matchId,
        });
      }
    }

    this.activeGames.set(gameId, {
      matchId: match.matchId,
      tickets,
    });

    this.log.info("ranked match created", {
      matchId: match.matchId,
      gameId,
      tickets: tickets.map((ticket) => ticket.ticketId),
    });
  }

  private async handleRankedGameFinished(game: GameServer): Promise<void> {
    const active = this.activeGames.get(game.id);
    if (!active) {
      return;
    }

    this.activeGames.delete(game.id);

    const matchResult = game.getMatchResult();
    if (matchResult) {
      await this.processMatchResult(active, game, matchResult);
      return;
    }

    // Fallback: no result available
    this.log.warn(
      "No match result for finished ranked game, marking as cancelled",
      {
        matchId: active.matchId,
        gameId: game.id,
      },
    );
    await this.finalizeOrphanedMatch(
      active.matchId,
      active.tickets,
      "no_result_on_finish",
    );
  }

  private async handleMatchDeclined(
    match: AcceptMatchState,
    declining?: RankedQueueTicket,
  ): Promise<void> {
    const updatedAt = Date.now();
    match.tickets.forEach((ticket) => {
      ticket.match = undefined;
      ticket.acceptToken = undefined;
      ticket.acceptedAt = undefined;
      ticket.updatedAt = updatedAt;
    });
    this.queue.requeueTickets(match.tickets);
    await this.persistTickets(match.tickets);
    this.broadcastMatchUpdate(match.tickets); // Notify clients match cancelled

    // Re-increment queue counters for requeued players
    for (const ticket of match.tickets) {
      await this.telemetry.incrementQueued(ticket.mode, ticket.region);
    }

    this.log.info("ranked match cancelled", {
      matchId: match.matchId,
      decliningTicket: declining?.ticketId,
    });
  }

  private buildRatingParticipants(
    tickets: RankedQueueTicket[],
    matchResult: GameMatchResult,
  ): RatingParticipantInput[] {
    const playersByPersistentId = new Map(
      matchResult.players.map((player) => [player.persistentID, player]),
    );

    return tickets.map((ticket) => {
      const player = playersByPersistentId.get(ticket.playerId);
      if (!player) {
        this.log.warn("Could not map ranked ticket to match participant", {
          matchId: ticket.match?.matchId ?? null,
          playerId: ticket.playerId,
        });
      }
      return {
        playerId: ticket.playerId,
        clientId: player?.clientID,
        persistentId: player?.persistentID ?? ticket.playerId,
      };
    });
  }

  private extractWinnerPlayerIds(
    winner: GameMatchResult["winner"],
    participants: RatingParticipantInput[],
    matchResult: GameMatchResult,
    matchId: string,
  ): string[] {
    if (!winner) {
      return [];
    }

    const clientMap = new Map<string, RatingParticipantInput>();
    const persistentMap = new Map<string, RatingParticipantInput>();
    for (const participant of participants) {
      if (participant.clientId) {
        clientMap.set(participant.clientId, participant);
      }
      if (participant.persistentId) {
        persistentMap.set(participant.persistentId, participant);
      }
    }

    const playerIds = new Set<string>();
    const collect = (clientId: string) => {
      const direct = clientMap.get(clientId);
      if (direct) {
        playerIds.add(direct.playerId);
        return;
      }
      const matchPlayer = matchResult.players.find(
        (entry) => entry.clientID === clientId,
      );
      if (!matchPlayer) {
        this.log.warn("Unable to map ranked winner client", {
          matchId,
          clientId,
        });
        return;
      }
      const persistent = persistentMap.get(matchPlayer.persistentID);
      if (!persistent) {
        this.log.warn("Unable to map ranked winner participant", {
          matchId,
          clientId,
          persistentID: matchPlayer.persistentID,
        });
        return;
      }
      playerIds.add(persistent.playerId);
    };

    if (winner[0] === "player") {
      const ids = (winner as unknown as string[]).slice(1);
      ids.forEach((clientId) => collect(String(clientId)));
    } else if (winner[0] === "team") {
      const winnerArray = winner as unknown as any[];
      const ids = winnerArray.slice(2);
      ids.forEach((clientId) => collect(String(clientId)));
    }

    return Array.from(playerIds);
  }

  private cloneTicket(ticket: RankedQueueTicket): RankedTicketView {
    return {
      ...ticket,
      match: ticket.match ? { ...ticket.match } : undefined,
    };
  }

  private async persistTicket(ticket: RankedQueueTicket): Promise<void> {
    if (!this.repository) {
      return;
    }
    await this.repository.saveQueueTicket(ticket);
  }

  private async persistTickets(tickets: RankedQueueTicket[]): Promise<void> {
    if (!this.repository) {
      return;
    }
    for (const ticket of tickets) {
      await this.repository.saveQueueTicket(ticket);
    }
  }

  // === WEBSOCKET METHODS ===

  handleWebSocketConnection(ws: WebSocket, req: IncomingMessage): void {
    const client: RankedWebSocketClient = {
      ws,
      playerId: null,
      subscribedTickets: new Set(),
    };
    this.wsClients.set(ws, client);

    this.log.info("Ranked WebSocket client connected", {
      url: req.url,
      headers: req.headers,
    });

    ws.on("message", (data: Buffer | string) => {
      try {
        const text = typeof data === "string" ? data : data.toString("utf8");
        const message = JSON.parse(text);
        this.handleWebSocketMessage(client, message);
      } catch (error) {
        this.log.warn("Invalid WebSocket message", { error });
      }
    });

    ws.on("close", () => {
      this.wsClients.delete(ws);
      this.log.info("Ranked WebSocket client disconnected", {
        playerId: client.playerId,
      });
    });

    ws.on("error", (error) => {
      this.log.error("Ranked WebSocket error", { error });
    });
  }

  private handleWebSocketMessage(
    client: RankedWebSocketClient,
    message: any,
  ): void {
    if (message.type === "subscribe") {
      client.playerId = message.playerId;
      if (message.ticketId) {
        client.subscribedTickets.add(message.ticketId);
      }
      this.log.debug("Client subscribed to ranked updates", {
        playerId: message.playerId,
        ticketId: message.ticketId,
      });
    } else if (message.type === "unsubscribe") {
      if (message.ticketId) {
        client.subscribedTickets.delete(message.ticketId);
      }
    } else if (message.type === "ping") {
      client.ws.send(JSON.stringify({ type: "pong" }));
    }
  }

  private broadcastTicketUpdate(ticket: RankedQueueTicket): void {
    const message = JSON.stringify({
      type: "ticket_update",
      ticket,
    });

    for (const [ws, client] of this.wsClients.entries()) {
      if (
        ws.readyState === WebSocket.OPEN &&
        (client.playerId === ticket.playerId ||
          client.subscribedTickets.has(ticket.ticketId))
      ) {
        ws.send(message);
      }
    }
  }

  private broadcastMatchUpdate(tickets: RankedQueueTicket[]): void {
    for (const ticket of tickets) {
      this.broadcastTicketUpdate(ticket);
    }
  }
}
