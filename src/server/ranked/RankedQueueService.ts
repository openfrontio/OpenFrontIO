import { Logger } from "winston";
import { generateID } from "../../core/Util";
import {
  RankedMatchInfo,
  RankedMatchState,
  RankedMode,
  RankedQueueJoinRequest,
  RankedQueueTicket,
  RankedRegion,
} from "./types";

export type RankedMatchHandler = (tickets: RankedQueueTicket[]) => void;

export class RankedQueueService {
  private readonly queues = new Map<string, RankedQueueTicket[]>();
  private readonly ticketsById = new Map<string, RankedQueueTicket>();
  private readonly ticketsByPlayer = new Map<string, RankedQueueTicket>();
  private readonly matchmakingInterval: NodeJS.Timeout;

  constructor(
    private readonly log: Logger,
    private readonly onMatch: RankedMatchHandler,
  ) {
    // Periodically try to match players as their search windows expand
    this.matchmakingInterval = setInterval(() => {
      this.recalculateMatches();
    }, 10_000); // Check every 10 seconds
  }

  destroy(): void {
    clearInterval(this.matchmakingInterval);
  }

  join(request: RankedQueueJoinRequest): RankedQueueTicket {
    const key = this.queueKey(request.mode, request.region);

    const existing = this.ticketsByPlayer.get(request.playerId);
    if (existing !== undefined) {
      if (existing.state !== "queued") {
        return existing;
      }
      this.leave(existing.ticketId);
    }

    const now = Date.now();
    const ticket: RankedQueueTicket = {
      ticketId: generateID(),
      playerId: request.playerId,
      mode: request.mode,
      region: request.region,
      mmr: request.mmr,
      state: "queued",
      joinedAt: now,
      updatedAt: now,
    };

    const queue = this.queues.get(key) ?? [];
    queue.push(ticket);
    this.queues.set(key, queue);

    this.ticketsById.set(ticket.ticketId, ticket);
    this.ticketsByPlayer.set(ticket.playerId, ticket);

    this.log.debug("ranked ticket joined", {
      ticketId: ticket.ticketId,
      playerId: ticket.playerId,
      mode: ticket.mode,
      region: ticket.region,
    });

    this.tryStartMatch(key);

    return ticket;
  }

  leave(ticketId: string): boolean {
    const ticket = this.ticketsById.get(ticketId);
    if (!ticket) {
      return false;
    }

    if (ticket.state !== "queued") {
      return false;
    }

    this.removeFromQueue(ticket);
    ticket.state = "cancelled";
    ticket.updatedAt = Date.now();
    this.ticketsById.delete(ticket.ticketId);
    const existing = this.ticketsByPlayer.get(ticket.playerId);
    if (existing?.ticketId === ticket.ticketId) {
      this.ticketsByPlayer.delete(ticket.playerId);
    }
    return true;
  }

  get(ticketId: string): RankedQueueTicket | undefined {
    return this.ticketsById.get(ticketId);
  }

  restoreTickets(tickets: RankedQueueTicket[]): void {
    tickets.forEach((ticket) => this.restoreTicket(ticket));
  }

  private restoreTicket(ticket: RankedQueueTicket): void {
    const key = this.queueKey(ticket.mode, ticket.region);
    const queue = this.queues.get(key) ?? [];
    if (!queue.some((entry) => entry.ticketId === ticket.ticketId)) {
      queue.push(ticket);
      this.queues.set(key, queue);
    }
    this.ticketsById.set(ticket.ticketId, ticket);
    this.ticketsByPlayer.set(ticket.playerId, ticket);
  }

  recalculateMatches(): void {
    for (const key of this.queues.keys()) {
      this.tryStartMatch(key);
    }
  }

  requeueTickets(tickets: RankedQueueTicket[]): void {
    const keys = new Set<string>();
    const now = Date.now();

    tickets.forEach((ticket) => {
      ticket.state = "queued";
      ticket.match = undefined;
      ticket.acceptToken = undefined;
      ticket.acceptedAt = undefined;
      ticket.joinedAt = now;
      ticket.updatedAt = now;

      const key = this.queueKey(ticket.mode, ticket.region);
      keys.add(key);
      const queue = this.queues.get(key);
      if (queue === undefined) {
        this.queues.set(key, [ticket]);
      } else if (!queue.some((entry) => entry.ticketId === ticket.ticketId)) {
        queue.push(ticket);
      }

      this.ticketsById.set(ticket.ticketId, ticket);
      this.ticketsByPlayer.set(ticket.playerId, ticket);
    });

    keys.forEach((key) => this.tryStartMatch(key));
  }

  completeMatch(matchId: string): RankedQueueTicket[] {
    const completed: RankedQueueTicket[] = [];
    const now = Date.now();

    for (const [ticketId, ticket] of Array.from(this.ticketsById.entries())) {
      if (ticket.match?.matchId !== matchId) {
        continue;
      }

      this.ticketsById.delete(ticketId);
      const existing = this.ticketsByPlayer.get(ticket.playerId);
      if (existing?.ticketId === ticket.ticketId) {
        this.ticketsByPlayer.delete(ticket.playerId);
      }

      ticket.state = "completed";
      ticket.updatedAt = now;
      if (ticket.match) {
        ticket.match = {
          ...ticket.match,
          state: "completed" as RankedMatchState,
        };
      }

      completed.push(ticket);
    }

    for (const [key, queue] of Array.from(this.queues.entries())) {
      const filtered = queue.filter(
        (entry) => entry.match?.matchId !== matchId,
      );
      if (filtered.length === 0) {
        this.queues.delete(key);
      } else if (filtered.length !== queue.length) {
        this.queues.set(key, filtered);
      }
    }

    return completed;
  }
  private queueKey(mode: RankedMode, region: RankedRegion): string {
    return `${mode}:${region}`;
  }

  private tryStartMatch(key: string): void {
    const queue = this.queues.get(key);
    if (!queue) {
      return;
    }

    const activeTickets = queue.filter((ticket) => ticket.state === "queued");
    if (activeTickets.length < 2) {
      return;
    }

    const now = Date.now();
    const selected = this.findBestMatch(activeTickets, now);
    if (!selected || selected.length < 2) {
      return;
    }

    // Remove the selected tickets from the queue while keeping order for the rest.
    this.queues.set(
      key,
      queue.filter(
        (ticket) => !selected.some((pick) => pick.ticketId === ticket.ticketId),
      ),
    );

    const matchId = generateID();
    const createdAt = Date.now();
    const matchInfo: RankedMatchInfo = {
      matchId,
      createdAt,
      mode: selected[0].mode,
      region: selected[0].region,
      tickets: selected.map((ticket) => ticket.ticketId),
      state: "awaiting_accept",
      acceptedCount: 0,
      totalPlayers: selected.length,
    };

    selected.forEach((ticket) => {
      ticket.state = "matched";
      ticket.updatedAt = createdAt;
      ticket.match = matchInfo;
    });

    this.log.info("ranked match candidate ready", {
      matchId,
      tickets: matchInfo.tickets,
      mode: matchInfo.mode,
      region: matchInfo.region,
    });

    this.onMatch(selected);
  }

  private findBestMatch(
    tickets: RankedQueueTicket[],
    now: number,
  ): RankedQueueTicket[] | null {
    if (tickets.length < 2) {
      return null;
    }

    // Sort by join time to prioritize longer waiting players
    const sorted = [...tickets].sort((a, b) => a.joinedAt - b.joinedAt);

    // Try to find best MMR match for the oldest ticket
    const oldest = sorted[0];
    const searchWindow = this.calculateSearchWindow(oldest, now);

    // Find all candidates within the search window
    const candidates = sorted.filter((ticket) => {
      // Don't match with self (by ticketId or playerId)
      if (
        ticket.ticketId === oldest.ticketId ||
        ticket.playerId === oldest.playerId
      ) {
        return false;
      }
      if (!ticket.mmr || !oldest.mmr) {
        return true; // Match players without MMR together
      }
      const mmrDiff = Math.abs(ticket.mmr - oldest.mmr);
      return mmrDiff <= searchWindow.mmrRange;
    });

    if (candidates.length === 0) {
      // If no candidates within window, match with closest MMR if waited long enough
      const waitTimeMs = now - oldest.joinedAt;
      if (waitTimeMs > 90_000 && sorted.length >= 2) {
        // After 90s, match with anyone (but not same player)
        const otherPlayer = sorted.find((t) => t.playerId !== oldest.playerId);
        if (otherPlayer) {
          return [oldest, otherPlayer];
        }
      }
      return null;
    }

    // Select the closest MMR match
    let bestMatch = candidates[0];
    if (oldest.mmr) {
      let smallestDiff = Math.abs((candidates[0].mmr ?? 1500) - oldest.mmr);
      for (const candidate of candidates.slice(1)) {
        const diff = Math.abs((candidate.mmr ?? 1500) - oldest.mmr);
        if (diff < smallestDiff) {
          smallestDiff = diff;
          bestMatch = candidate;
        }
      }
    }

    return [oldest, bestMatch];
  }

  private calculateSearchWindow(
    ticket: RankedQueueTicket,
    now: number,
  ): { mmrRange: number; pingMax: number } {
    const waitTimeMs = now - ticket.joinedAt;
    const waitTimeSec = Math.floor(waitTimeMs / 1000);

    // T0-30s: ±100 MMR
    if (waitTimeSec <= 30) {
      return { mmrRange: 100, pingMax: 50 };
    }

    // 30-90s: expand ±50 MMR every 15s
    if (waitTimeSec <= 90) {
      const intervals = Math.floor((waitTimeSec - 30) / 15);
      return { mmrRange: 100 + intervals * 50, pingMax: 50 + intervals * 25 };
    }

    // 90-180s: expand up to ±400 MMR
    if (waitTimeSec <= 180) {
      const intervals = Math.floor((waitTimeSec - 90) / 15);
      return { mmrRange: Math.min(400, 200 + intervals * 50), pingMax: 120 };
    }

    // After 180s: max search window
    return { mmrRange: 400, pingMax: 120 };
  }

  private removeFromQueue(ticket: RankedQueueTicket): void {
    const key = this.queueKey(ticket.mode, ticket.region);
    const queue = this.queues.get(key);
    if (!queue) {
      return;
    }
    const filtered = queue.filter(
      (entry) => entry.ticketId !== ticket.ticketId,
    );
    if (filtered.length === 0) {
      this.queues.delete(key);
    } else if (filtered.length !== queue.length) {
      this.queues.set(key, filtered);
    }
  }
}
