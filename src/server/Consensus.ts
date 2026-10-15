import {
  AllPlayersStats,
  ClientID,
  Winner,
} from "@openfront/engine-api/Schemas";
import {
  ClientSendWinnerMessage,
  LiveStats,
} from "@openfront/shared/WireSchemas";
import { createHash } from "crypto";
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

// A fingerprint of a winner vote's per-player stats, so votes can be compared
// on their stats and not just their winner. The stats come from the
// deterministic simulation, so in-sync clients hold the same values -- but not
// necessarily in the same key order: record keys follow insertion order, which
// differs between a client that played the whole game and one restored from a
// snapshot. So keys are sorted at every level before hashing. Bigints hash as
// decimal strings, the form the archive writes them in (Util.replacer).
export function statsDigest(stats: AllPlayersStats): string {
  const canonical = JSON.stringify(stats, (_key, value: unknown) => {
    if (typeof value === "bigint") return value.toString();
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort()
          .map((k) => [k, obj[k]]),
      );
    }
    return value;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// The end-of-game winner vote. A vote is the whole message: the winner and
// every player's stats. Voters who name the same winner but send different
// stats back different candidates, so one voter can't put forged stats in the
// record by agreeing with the majority on the winner. Decided once; the game
// guards against votes arriving after that.
export class WinnerVote {
  private readonly round = new VoteRound<ClientSendWinnerMessage>();
  private decided: ClientSendWinnerMessage | null = null;

  // The winning message once a majority has backed one, else null.
  winner(): ClientSendWinnerMessage | null {
    return this.decided;
  }

  // How many different messages the votes so far have sent.
  candidates(): number {
    return this.round.size();
  }

  // How many unique IPs sent the decided message, departed ones included;
  // 0 before a decision. Every one of them sent the same winner and stats.
  backers(): number {
    return this.decided === null
      ? 0
      : this.round.backers(voteKey(this.decided));
  }

  // Records a vote from `ip`. Returns the candidate's key and how many unique
  // IPs back it after this vote.
  cast(
    msg: ClientSendWinnerMessage,
    ip: string,
  ): { key: string; votes: number } {
    const key = voteKey(msg);
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

// Identifies a winner vote by its winner and its stats, so a replayed result
// can be compared with the votes the same way. A cancelled match ends with
// winner omitted; JSON.stringify(undefined) is not a string, so key it as null.
export function voteKey(result: {
  winner?: Winner;
  allPlayersStats: AllPlayersStats;
}): string {
  return JSON.stringify([
    result.winner ?? null,
    statsDigest(result.allPlayersStats),
  ]);
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
