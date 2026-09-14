import { ClientID, ClientSendWinnerMessage, LiveStats } from "../core/Schemas";
import { VoteRound } from "./VoteTally";

// The simulation runs on the clients, so the outcomes the server has to
// report — who won, and what the board looks like right now — exist only as
// claims from clients. Both are settled by the same IP-weighted majority
// vote (VoteTally.ts); these two classes keep the per-game state around it.
// Who is allowed to vote (not a spectator, not desynced, not kicked) and
// what happens once a vote settles are the game's business, not theirs.

export interface VoteOutcome<T> {
  value: T;
  votes: number;
}

// The end-of-game winner vote. Decided once; the game guards against votes
// arriving after that.
export class WinnerVote {
  private readonly round = new VoteRound<ClientSendWinnerMessage>();
  private decided: ClientSendWinnerMessage | null = null;

  // The winning message once a majority has backed one, else null.
  winner(): ClientSendWinnerMessage | null {
    return this.decided;
  }

  // Records a vote from `ip`. Returns the candidate's key and how many unique
  // IPs back it after this vote.
  cast(
    msg: ClientSendWinnerMessage,
    ip: string,
  ): { key: string; votes: number } {
    // A cancelled match ends with winner omitted; JSON.stringify(undefined)
    // is not a string, so key those votes as "null".
    const key = JSON.stringify(msg.winner ?? null);
    return { key, votes: this.round.add(key, msg, ip) };
  }

  // Decides the vote if some candidate holds a strict majority of an
  // electorate of `electorate` unique IPs.
  tally(electorate: number): VoteOutcome<ClientSendWinnerMessage> | null {
    const result = this.round.result(electorate);
    if (result !== null) {
      this.decided = result.value;
    }
    return result;
  }

  // Re-tally against a shrunken electorate: only votes from `activeIPs`
  // count, and only against `activeIPs.size` (see VoteRound.resultAmong).
  tallyAmong(
    activeIPs: Set<string>,
  ): VoteOutcome<ClientSendWinnerMessage> | null {
    const result = this.round.resultAmong(activeIPs);
    if (result !== null) {
      this.decided = result.value;
    }
    return result;
  }
}

// The running live-stats vote. Clients each send a snapshot every ~10s
// tagged with the turn it was taken at; in-sync clients produce an identical
// snapshot for a given turn, so a majority settles it and the latest settled
// snapshot is what the admin bot reads.
export class LiveStatsVote {
  // Bound on the pending rounds in case consensus is never reached for some
  // turns (e.g. a persistent desync). Maps iterate in insertion order and
  // turns arrive ascending, so pruning drops the oldest pending rounds.
  private static readonly MAX_PENDING_ROUNDS = 20;

  // Tallies keyed by turn number; an entry is removed once consensus is
  // reached for that turn (or a later one) so the map stays small.
  private readonly rounds: Map<
    number,
    { round: VoteRound<LiveStats>; voters: Set<ClientID> }
  > = new Map();
  private settled: LiveStats | null = null;

  // The latest snapshot a majority agreed on, or null before the first.
  latest(): LiveStats | null {
    return this.settled;
  }

  // Records a client's snapshot, one vote per client per turn, against an
  // electorate of `electorate` unique IPs. Returns whether this vote settled
  // its turn. Turns at or before the latest settled one are ignored.
  cast(
    clientID: ClientID,
    ip: string,
    stats: LiveStats,
    electorate: number,
  ): boolean {
    const turn = stats.turn;
    if (this.settled !== null && turn <= this.settled.turn) {
      return false;
    }

    let entry = this.rounds.get(turn);
    if (entry === undefined) {
      entry = { round: new VoteRound<LiveStats>(), voters: new Set() };
      this.rounds.set(turn, entry);
      this.prune();
    }
    if (entry.voters.has(clientID)) {
      return false;
    }
    entry.voters.add(clientID);

    entry.round.add(JSON.stringify(stats), stats, ip);
    const result = entry.round.result(electorate);
    if (result === null) {
      return false;
    }

    this.settled = result.value;
    // This turn (and any older still-pending ones) are now settled.
    for (const t of this.rounds.keys()) {
      if (t <= turn) {
        this.rounds.delete(t);
      }
    }
    return true;
  }

  private prune(): void {
    while (this.rounds.size > LiveStatsVote.MAX_PENDING_ROUNDS) {
      const oldest = this.rounds.keys().next().value;
      if (oldest === undefined) break;
      this.rounds.delete(oldest);
    }
  }
}
