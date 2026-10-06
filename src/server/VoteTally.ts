// IP-weighted single-round vote used to reach consensus on a value that the
// authoritative simulation only exists for on the clients (which run the game),
// not the server. Clients each vote for a candidate value; a candidate wins once
// a strict majority of the electorate's unique IPs back it.
//
// Used both for end-of-game winner consensus and for periodic running-stats
// consensus (see GameServer).

// The one majority rule every vote here uses: strictly more than half of the
// electorate's unique IPs. A tie (e.g. 1 of 2 IPs) does not count as a
// majority: with exactly 2 electors, both must agree, otherwise one of two
// players in a 1v1 could unilaterally declare themselves the winner. (#4136)
export function isStrictMajority(votes: number, electorate: number): boolean {
  return votes * 2 > electorate;
}

// A candidate and how many unique IPs back it.
export interface Standing<T> {
  key: string;
  value: T;
  votes: number;
}

export class VoteRound<T> {
  private candidates = new Map<string, { value: T; ips: Set<string> }>();

  // Records a vote for `value` (identified by the stable string `key`) from
  // `ip`. Repeat votes from the same IP for the same candidate are idempotent.
  // Returns the candidate's unique-IP vote count after the vote.
  add(key: string, value: T, ip: string): number {
    let candidate = this.candidates.get(key);
    if (candidate === undefined) {
      candidate = { value, ips: new Set() };
      this.candidates.set(key, candidate);
    }
    candidate.ips.add(ip);
    return candidate.ips.size;
  }

  // How many distinct values have been voted for.
  size(): number {
    return this.candidates.size;
  }

  // Returns the winning value once some candidate holds a strict majority of
  // `totalUniqueIPs` (isStrictMajority), else null. The first candidate voted
  // for wins if, through shared IPs, more than one holds a majority.
  result(totalUniqueIPs: number): { value: T; votes: number } | null {
    for (const candidate of this.candidates.values()) {
      if (isStrictMajority(candidate.ips.size, totalUniqueIPs)) {
        return { value: candidate.value, votes: candidate.ips.size };
      }
    }
    return null;
  }

  // Re-tally against a shrunken electorate: like result(), but both the
  // electorate and the counted votes are restricted to `activeIPs`. Votes
  // from departed IPs must not count here — otherwise a player could vote
  // for themselves and disconnect, and the re-tally triggered by their own
  // departure would crown them (#4136 again, one step removed).
  resultAmong(activeIPs: Set<string>): { value: T; votes: number } | null {
    for (const candidate of this.candidates.values()) {
      let votes = 0;
      for (const ip of candidate.ips) {
        if (activeIPs.has(ip)) {
          votes++;
        }
      }
      if (isStrictMajority(votes, activeIPs.size)) {
        return { value: candidate.value, votes };
      }
    }
    return null;
  }

  // Every candidate with its unique-IP vote count, in the order each was
  // first voted for. With `activeIPs`, only votes from those IPs count, as in
  // resultAmong().
  standings(activeIPs?: ReadonlySet<string>): Standing<T>[] {
    return [...this.candidates].map(([key, { value, ips }]) => {
      let votes = ips.size;
      if (activeIPs !== undefined) {
        votes = 0;
        for (const ip of ips) {
          if (activeIPs.has(ip)) votes++;
        }
      }
      return { key, value, votes };
    });
  }

  // The unique IPs behind the candidate `key` (empty if nobody voted for it).
  backers(key: string): ReadonlySet<string> {
    return this.candidates.get(key)?.ips ?? new Set();
  }

  // Every unique IP that voted, for any candidate.
  voters(): Set<string> {
    const ips = new Set<string>();
    for (const candidate of this.candidates.values()) {
      candidate.ips.forEach((ip) => ips.add(ip));
    }
    return ips;
  }
}
