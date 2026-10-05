import { AllPlayersStats, ClientID } from "@openfront/engine-api/Schemas";
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

// How the voters for the decided winner split on stats. Counted in unique IPs,
// like the vote itself, over every vote received for that winner (departed
// voters included).
export interface StatsAgreement {
  // IPs that voted for the decided winner.
  voters: number;
  // Distinct stats among those votes; 1 means everyone agreed.
  versions: number;
  // IPs that sent the stats the record carries (the first vote for the winner).
  archivedBackers: number;
  // IPs behind the most-backed stats.
  topBackers: number;
}

// The end-of-game winner vote. Decided once; the game guards against votes
// arriving after that.
export class WinnerVote {
  private readonly round = new VoteRound<ClientSendWinnerMessage>();
  private decided: ClientSendWinnerMessage | null = null;
  // Per winner key: the IPs behind each stats digest, and the digest of the
  // first vote -- the one VoteRound keeps as the candidate's value.
  private readonly statsBackers = new Map<string, Map<string, Set<string>>>();
  private readonly firstDigest = new Map<string, string>();

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
    const key = winnerKey(msg);
    const digest = statsDigest(msg.allPlayersStats);
    if (!this.firstDigest.has(key)) this.firstDigest.set(key, digest);
    let byDigest = this.statsBackers.get(key);
    if (byDigest === undefined) {
      byDigest = new Map();
      this.statsBackers.set(key, byDigest);
    }
    let ips = byDigest.get(digest);
    if (ips === undefined) {
      ips = new Set();
      byDigest.set(digest, ips);
    }
    ips.add(ip);
    return { key, votes: this.round.add(key, msg, ip) };
  }

  // How the decided winner's voters split on stats, or null while undecided.
  // Observation only: the vote is still decided on the winner alone.
  statsAgreement(): StatsAgreement | null {
    if (this.decided === null) return null;
    const key = winnerKey(this.decided);
    const byDigest = this.statsBackers.get(key);
    const first = this.firstDigest.get(key);
    if (byDigest === undefined || first === undefined) return null;
    const voters = new Set<string>();
    let topBackers = 0;
    for (const ips of byDigest.values()) {
      ips.forEach((ip) => voters.add(ip));
      topBackers = Math.max(topBackers, ips.size);
    }
    return {
      voters: voters.size,
      versions: byDigest.size,
      archivedBackers: byDigest.get(first)?.size ?? 0,
      topBackers,
    };
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

// A cancelled match ends with winner omitted; JSON.stringify(undefined) is not
// a string, so key those votes as "null".
function winnerKey(msg: ClientSendWinnerMessage): string {
  return JSON.stringify(msg.winner ?? null);
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
