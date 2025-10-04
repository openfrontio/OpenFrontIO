import { Logger } from "winston";
import { RankedQueueTicket } from "./types";

export interface AcceptMatchState {
  matchId: string;
  tickets: RankedQueueTicket[];
  acceptDeadline: number;
}

export class AcceptCoordinator {
  private readonly matches = new Map<string, AcceptMatchState>();
  private readonly dodgePenalties = new Map<
    string,
    { count: number; lastDodgeAt: number }
  >();
  private readonly DODGE_PENALTIES_MS = [120_000, 300_000, 600_000]; // 2m, 5m, 10m

  private updateAcceptanceProgress(match: AcceptMatchState): void {
    const totalPlayers = match.tickets.length;
    const acceptedCount = match.tickets.filter(
      (t) => t.acceptedAt !== undefined,
    ).length;
    match.tickets.forEach((ticket) => {
      if (ticket.match) {
        ticket.match = {
          ...ticket.match,
          totalPlayers,
          acceptedCount,
        };
      }
    });
  }

  constructor(
    private readonly onAllAccepted: (
      match: AcceptMatchState,
    ) => Promise<void> | void,
    private readonly onDeclined: (
      match: AcceptMatchState,
      declining?: RankedQueueTicket,
    ) => Promise<void> | void,
    private readonly log: Logger,
  ) {
    // Clean up old dodge penalties every hour
    setInterval(() => this.cleanupDodgePenalties(), 3600_000);
  }

  private cleanupDodgePenalties(): void {
    const now = Date.now();
    const dayAgo = now - 86400_000; // 24 hours
    for (const [playerId, penalty] of this.dodgePenalties.entries()) {
      if (penalty.lastDodgeAt < dayAgo) {
        this.dodgePenalties.delete(playerId);
      }
    }
  }

  private applyDodgePenalty(playerId: string): number {
    const now = Date.now();
    const penalty = this.dodgePenalties.get(playerId) ?? {
      count: 0,
      lastDodgeAt: 0,
    };

    // Reset count if last dodge was more than a day ago
    if (now - penalty.lastDodgeAt > 86400_000) {
      penalty.count = 0;
    }

    penalty.count += 1;
    penalty.lastDodgeAt = now;
    this.dodgePenalties.set(playerId, penalty);

    const penaltyIndex = Math.min(
      penalty.count - 1,
      this.DODGE_PENALTIES_MS.length - 1,
    );
    const penaltyMs = this.DODGE_PENALTIES_MS[penaltyIndex];

    this.log.info("Applied dodge penalty", {
      playerId,
      dodgeCount: penalty.count,
      penaltyMs,
    });

    return now + penaltyMs;
  }

  register(match: AcceptMatchState): void {
    this.matches.set(match.matchId, match);
    this.updateAcceptanceProgress(match);

    // Schedule timeout check
    const timeoutMs = match.acceptDeadline - Date.now() + 1000; // Add 1s buffer
    setTimeout(
      () => {
        this.checkTimeout(match.matchId);
      },
      Math.max(0, timeoutMs),
    );
  }

  async accept(
    matchId: string,
    ticketId: string,
    acceptToken: string,
  ): Promise<RankedQueueTicket | undefined> {
    const match = this.matches.get(matchId);
    if (!match) {
      return undefined;
    }

    const ticket = match.tickets.find((t) => t.ticketId === ticketId);
    if (!ticket) {
      return undefined;
    }

    if (ticket.acceptToken !== acceptToken) {
      this.log.warn("invalid accept token", {
        matchId,
        ticketId,
      });
      return undefined;
    }

    if (ticket.acceptedAt) {
      return ticket;
    }

    ticket.acceptedAt = Date.now();
    ticket.updatedAt = ticket.acceptedAt;

    this.updateAcceptanceProgress(match);

    const allAccepted = match.tickets.every((t) => t.acceptedAt !== undefined);
    if (allAccepted) {
      this.log.info("All players accepted, finalizing match", { matchId });
      this.matches.delete(matchId);
      try {
        await Promise.resolve(this.onAllAccepted(match));
      } catch (error) {
        this.log.error("Error in onAllAccepted callback", { matchId, error });
        throw error;
      }
    }

    return ticket;
  }

  async decline(
    matchId: string,
    ticketId: string,
  ): Promise<RankedQueueTicket | undefined> {
    const match = this.matches.get(matchId);
    if (!match) {
      return undefined;
    }

    const ticket = match.tickets.find((t) => t.ticketId === ticketId);

    // Apply dodge penalty to the declining player
    if (ticket) {
      ticket.dodgePenaltyUntil = this.applyDodgePenalty(ticket.playerId);
    }

    this.matches.delete(matchId);
    await Promise.resolve(this.onDeclined(match, ticket));
    return ticket;
  }

  checkTimeout(matchId: string): void {
    const match = this.matches.get(matchId);
    if (!match) {
      return;
    }

    const now = Date.now();
    if (now < match.acceptDeadline) {
      return;
    }

    // Apply penalty to all players who didn't accept
    match.tickets.forEach((ticket) => {
      if (!ticket.acceptedAt) {
        ticket.dodgePenaltyUntil = this.applyDodgePenalty(ticket.playerId);
      }
    });

    this.matches.delete(matchId);
    void Promise.resolve(this.onDeclined(match));
  }

  getMatch(matchId: string): AcceptMatchState | undefined {
    return this.matches.get(matchId);
  }
}
