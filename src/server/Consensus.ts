import { createHash } from "crypto";
import {
  AllPlayersStats,
  ClientID,
  ClientSendWinnerMessage,
  LiveStats,
} from "../core/Schemas";
import { isStrictMajority, Standing, VoteRound } from "./VoteTally";

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

// The per-player stats the archive carries, chosen when the winner is decided.
//
// The winner vote is keyed on the winner alone, so its voters can still
// disagree on stats. Among them, each distinct stats digest is a candidate of
// its own, counted in unique IPs over the same electorate and by the same
// strict-majority rule (isStrictMajority) as the winner vote at the moment it
// was decided. `agreed` is true only when exactly one version reaches that
// majority; that version is what the archive carries. Otherwise the archive
// carries the most-backed version (the earliest on a tie, which is the first
// vote, as before stats were checked) and `agreed` is false.
export interface ArchivedStats {
  stats: AllPlayersStats;
  agreed: boolean;
}

// How the voters for the decided winner split on stats. Counted in unique IPs,
// like the vote itself, over every vote received for that winner (departed
// voters included).
export interface StatsAgreement {
  // IPs that voted for the decided winner.
  voters: number;
  // Distinct stats among those votes; 1 means everyone agreed.
  versions: number;
  // IPs that sent the stats the record carries.
  archivedBackers: number;
  // IPs behind the most-backed stats.
  topBackers: number;
  // Whether the stats the record carries reached a majority (ArchivedStats).
  agreed: boolean;
}

// The end-of-game winner vote. Decided once; the game guards against votes
// arriving after that.
//
// Deciding the winner looks at the winner alone: stats never delay the
// decision or change its outcome. They only choose which stats the record
// carries and whether those count as agreed (ArchivedStats).
export class WinnerVote {
  private readonly round = new VoteRound<ClientSendWinnerMessage>();
  private decided: ClientSendWinnerMessage | null = null;
  // Per winner key: its voters' stats, as a vote keyed by stats digest.
  private readonly statsRounds = new Map<string, VoteRound<AllPlayersStats>>();
  // Settled together with `decided`.
  private decidedStats: (ArchivedStats & { digest: string }) | null = null;

  // The winning message once a majority has backed one, else null. Its
  // allPlayersStats are the first voter's; the record takes archivedStats().
  winner(): ClientSendWinnerMessage | null {
    return this.decided;
  }

  // The stats the record carries, or null while undecided.
  archivedStats(): ArchivedStats | null {
    if (this.decidedStats === null) return null;
    const { stats, agreed } = this.decidedStats;
    return { stats, agreed };
  }

  // Records a vote from `ip`. Returns the candidate's key and how many unique
  // IPs back it after this vote.
  cast(
    msg: ClientSendWinnerMessage,
    ip: string,
  ): { key: string; votes: number } {
    const key = winnerKey(msg);
    let stats = this.statsRounds.get(key);
    if (stats === undefined) {
      stats = new VoteRound();
      this.statsRounds.set(key, stats);
    }
    stats.add(statsDigest(msg.allPlayersStats), msg.allPlayersStats, ip);
    return { key, votes: this.round.add(key, msg, ip) };
  }

  // How the decided winner's voters split on stats, or null while undecided.
  // For the "winner stats agreement" log line, which keeps the agreement rate
  // measurable.
  statsAgreement(): StatsAgreement | null {
    if (this.decided === null || this.decidedStats === null) return null;
    const stats = this.statsRounds.get(winnerKey(this.decided));
    if (stats === undefined) return null;
    const standings = stats.standings();
    return {
      voters: stats.voters().size,
      versions: standings.length,
      archivedBackers: stats.backers(this.decidedStats.digest).size,
      topBackers: Math.max(...standings.map((s) => s.votes)),
      agreed: this.decidedStats.agreed,
    };
  }

  // Decides the vote if some candidate holds a strict majority of an
  // electorate of `electorate` unique IPs.
  tally(electorate: number): VoteOutcome<ClientSendWinnerMessage> | null {
    const result = this.round.result(electorate);
    if (result !== null) {
      this.decide(result.value, electorate);
    }
    return result;
  }

  // Re-tally against a shrunken electorate: only votes from `activeIPs`
  // count, and only against `activeIPs.size` (see VoteRound.resultAmong).
  // Stats are settled the same way, so a departed voter's stats count no more
  // than their winner vote does.
  tallyAmong(
    activeIPs: Set<string>,
  ): VoteOutcome<ClientSendWinnerMessage> | null {
    const result = this.round.resultAmong(activeIPs);
    if (result !== null) {
      this.decide(result.value, activeIPs.size, activeIPs);
    }
    return result;
  }

  // Settles the stats with the winner, counted the way the winner was: all
  // votes against `electorate`, or only `activeIPs`' votes.
  private decide(
    msg: ClientSendWinnerMessage,
    electorate: number,
    activeIPs?: ReadonlySet<string>,
  ): void {
    this.decided = msg;
    const standings =
      this.statsRounds.get(winnerKey(msg))?.standings(activeIPs) ?? [];
    this.decidedStats = settleStats(standings, electorate) ?? {
      // Unreachable: a decided winner has votes, and so stats. Fall back to
      // the first vote's stats, never agreed.
      stats: msg.allPlayersStats,
      agreed: false,
      digest: statsDigest(msg.allPlayersStats),
    };
  }
}

// Picks the stats version the record carries from the decided winner's
// voters (see ArchivedStats).
function settleStats(
  standings: Standing<AllPlayersStats>[],
  electorate: number,
): (ArchivedStats & { digest: string }) | null {
  const majorities = standings.filter((s) =>
    isStrictMajority(s.votes, electorate),
  );
  // Shared IPs can count toward two versions at once, so in principle more
  // than one can hold a majority. Then there is no single agreed version.
  if (majorities.length === 1) {
    const [{ key, value }] = majorities;
    return { stats: value, agreed: true, digest: key };
  }
  let top: Standing<AllPlayersStats> | undefined;
  for (const s of standings) {
    if (top === undefined || s.votes > top.votes) top = s;
  }
  if (top === undefined) return null;
  return { stats: top.value, agreed: false, digest: top.key };
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
