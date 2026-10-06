import { AllPlayersStats, ClientID } from "@openfront/engine-api/Schemas";
import {
  ClientSendWinnerMessage,
  LiveStats,
} from "@openfront/shared/WireSchemas";
import { createHash } from "crypto";
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

// The per-player stats the archive carries.
//
// The winner vote is keyed on the winner alone, so its voters can still
// disagree on stats. Among them, each distinct stats digest is a candidate of
// its own, counted in unique IPs by the same strict-majority rule
// (isStrictMajority) as the winner vote. `agreed` is true only when exactly
// one version reaches that majority; that version is what the archive
// carries. Otherwise the archive carries the most-backed version (the
// earliest on a tie, which is the first vote, as before stats were checked)
// and `agreed` is false.
//
// When the winner is decided, the stats are counted the way the winner was:
// all votes against the electorate it was decided by, or only active IPs'
// votes after the electorate shrank. If no version has a majority then, the
// stats stay open for a short window (GameServer.STATS_VOTE_WINDOW_MS): voters
// who had not yet voted may still vote, with effect only on the stats of the
// decided winner, and the stats are counted the way the shrink path counts --
// only still-active IPs' votes, against the still-active electorate -- until
// one version has a majority, everyone left has voted, or time runs out.
// Without the window, one forged vote among the deciding majority would leave
// the honest version a vote short every time.
export interface ArchivedStats {
  stats: AllPlayersStats;
  agreed: boolean;
}

// How the voters for the decided winner split on stats. Counted in unique IPs,
// like the vote itself, over every vote received for that winner (departed
// voters and votes in the stats window included).
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

type SettledStats = ArchivedStats & { digest: string };

// The end-of-game winner vote. Decided once; the game guards against votes
// arriving after that, other than stats votes while the stats are open.
//
// Deciding the winner looks at the winner alone: stats never delay the
// decision or change its outcome. They only choose which stats the record
// carries and whether those count as agreed (ArchivedStats).
export class WinnerVote {
  private readonly round = new VoteRound<ClientSendWinnerMessage>();
  private decided: ClientSendWinnerMessage | null = null;
  // Per winner key: its voters' stats, as a vote keyed by stats digest.
  private readonly statsRounds = new Map<string, VoteRound<AllPlayersStats>>();
  // Null until the stats are settled: at the decision if a version already
  // has a majority, else by settleStatsAmong.
  private settled: SettledStats | null = null;

  // The winning message once a majority has backed one, else null. Its
  // allPlayersStats are the first voter's; the record takes archivedStats().
  winner(): ClientSendWinnerMessage | null {
    return this.decided;
  }

  // Whether the winner is decided but the stats are still open.
  statsOpen(): boolean {
    return this.decided !== null && this.settled === null;
  }

  // The stats the record carries, or null until settled.
  archivedStats(): ArchivedStats | null {
    if (this.settled === null) return null;
    const { stats, agreed } = this.settled;
    return { stats, agreed };
  }

  // How many different winners the votes so far have named.
  candidates(): number {
    return this.round.size();
  }

  // Records a vote from `ip`. Returns the candidate's key and how many unique
  // IPs back it after this vote.
  cast(
    msg: ClientSendWinnerMessage,
    ip: string,
  ): { key: string; votes: number } {
    const key = winnerKey(msg);
    this.addStats(key, msg, ip);
    return { key, votes: this.round.add(key, msg, ip) };
  }

  // A vote arriving after the decision, while the stats are open. It never
  // touches the winner; it counts toward the stats only if it backs the
  // decided winner. Returns whether it counted.
  castStats(msg: ClientSendWinnerMessage, ip: string): boolean {
    if (!this.statsOpen() || this.decided === null) return false;
    const key = winnerKey(msg);
    if (key !== winnerKey(this.decided)) return false;
    this.addStats(key, msg, ip);
    return true;
  }

  // Settles the open stats if exactly one version holds a strict majority of
  // `activeIPs`, counting only their votes (as VoteRound.resultAmong does).
  // With `force`, settles regardless: unagreed, on the most-backed version of
  // all votes. Returns whether the stats are settled after the call.
  settleStatsAmong(activeIPs: ReadonlySet<string>, force: boolean): boolean {
    if (this.decided === null) return false;
    if (this.settled !== null) return true;
    const stats = this.statsRounds.get(winnerKey(this.decided));
    const among = settleStats(
      stats?.standings(activeIPs) ?? [],
      activeIPs.size,
    );
    if (among?.agreed) {
      this.settled = among;
    } else if (force) {
      // Against an infinite electorate nothing is a majority: this is the
      // most-backed version of all votes.
      const all = settleStats(stats?.standings() ?? [], Infinity);
      this.settled = all ?? {
        // Unreachable: a decided winner has votes, and so stats. Fall back to
        // the first vote's stats, never agreed.
        stats: this.decided.allPlayersStats,
        agreed: false,
        digest: statsDigest(this.decided.allPlayersStats),
      };
    }
    return this.settled !== null;
  }

  // How the decided winner's voters split on stats, or null until settled.
  // For the "winner stats agreement" log line, which keeps the agreement rate
  // measurable.
  statsAgreement(): StatsAgreement | null {
    if (this.decided === null || this.settled === null) return null;
    const stats = this.statsRounds.get(winnerKey(this.decided));
    if (stats === undefined) return null;
    const standings = stats.standings();
    return {
      voters: stats.voters().size,
      versions: standings.length,
      archivedBackers: stats.backers(this.settled.digest).size,
      topBackers: Math.max(...standings.map((s) => s.votes)),
      agreed: this.settled.agreed,
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
  // Stats are counted the same way, so a departed voter's stats count no more
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

  // Settles the stats with the winner if a version already has a majority,
  // counted the way the winner was: all votes against `electorate`, or only
  // `activeIPs`' votes. Otherwise they stay open.
  private decide(
    msg: ClientSendWinnerMessage,
    electorate: number,
    activeIPs?: ReadonlySet<string>,
  ): void {
    this.decided = msg;
    const standings =
      this.statsRounds.get(winnerKey(msg))?.standings(activeIPs) ?? [];
    const now = settleStats(standings, electorate);
    this.settled = now?.agreed ? now : null;
  }

  private addStats(key: string, msg: ClientSendWinnerMessage, ip: string) {
    let stats = this.statsRounds.get(key);
    if (stats === undefined) {
      stats = new VoteRound();
      this.statsRounds.set(key, stats);
    }
    stats.add(statsDigest(msg.allPlayersStats), msg.allPlayersStats, ip);
  }
}

// Picks a stats version from the decided winner's voters (see ArchivedStats):
// the one version with a strict majority of `electorate` (agreed), else the
// most-backed (not agreed). Null only when there are no stats at all.
function settleStats(
  standings: Standing<AllPlayersStats>[],
  electorate: number,
): SettledStats | null {
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
