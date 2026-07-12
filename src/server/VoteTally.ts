// IP-weighted single-round vote used to reach consensus on a value that the
// authoritative simulation only exists for on the clients (which run the game),
// not the server. Clients each vote for a candidate value; a candidate wins once
// a strict majority of the electorate's unique IPs back it.
//
// Used both for end-of-game winner consensus and for periodic running-stats
// consensus (see GameServer).
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

  // Returns the winning value once some candidate holds a strict majority of
  // `totalUniqueIPs` (votes * 2 > total), else null. A tie (e.g. 1 of 2 IPs)
  // does not count as a majority: with exactly 2 electors, both must agree,
  // otherwise one of two players in a 1v1 could unilaterally declare
  // themselves the winner. (#4136)
  result(totalUniqueIPs: number): { value: T; votes: number } | null {
    for (const candidate of this.candidates.values()) {
      if (candidate.ips.size * 2 > totalUniqueIPs) {
        return { value: candidate.value, votes: candidate.ips.size };
      }
    }
    return null;
  }
}
