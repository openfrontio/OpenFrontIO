import { ClientID } from "../core/Schemas";
import { Client } from "./Client";

// Desync detection. The simulation runs on every client; each reports a hash
// of its state per turn, and the server compares them after the fact. A
// client whose hash disagrees with the majority is told once, and stays
// counted as desynced (its winner and live-stats votes are ignored) for the
// rest of the game.

export interface HashTally {
  mostCommonHash: number | null;
  outOfSyncClients: Client[];
}

// Tallies the hashes the active clients reported for `turnNumber`. Clients
// that reported nothing for that turn are not counted. When a strict majority
// disagrees with the most common hash, nobody can be trusted and everyone is
// out of sync.
export function findOutOfSyncClients(
  active: readonly Client[],
  turnNumber: number,
): HashTally {
  const counts = new Map<number, number>();

  // Count occurrences of each hash
  for (const client of active) {
    if (client.hashes.has(turnNumber)) {
      const clientHash = client.hashes.get(turnNumber)!;
      counts.set(clientHash, (counts.get(clientHash) ?? 0) + 1);
    }
  }

  // Find the most common hash
  let mostCommonHash: number | null = null;
  let maxCount = 0;

  for (const [hash, count] of counts.entries()) {
    if (count > maxCount) {
      mostCommonHash = hash;
      maxCount = count;
    }
  }

  // Create a list of clients whose hash doesn't match the most common one
  let outOfSyncClients: Client[] = [];

  for (const client of active) {
    if (client.hashes.has(turnNumber)) {
      const clientHash = client.hashes.get(turnNumber)!;
      if (clientHash !== mostCommonHash) {
        outOfSyncClients.push(client);
      }
    }
  }

  // If strict majority clients out of sync assume all are out of sync.
  if (outOfSyncClients.length > Math.floor(active.length / 2)) {
    outOfSyncClients = [...active];
  }

  return {
    mostCommonHash,
    outOfSyncClients,
  };
}

export interface DesyncCheck extends HashTally {
  // The turn whose hashes were compared.
  turn: number;
}

// Hashes are checked every ten turns, for the turn ten back — clients have
// had that long to report it.
const CHECK_INTERVAL = 10;

export class DesyncDetector {
  private readonly desynced = new Set<ClientID>();
  private readonly notified = new Set<ClientID>();

  // How many clients have been found out of sync so far.
  count(): number {
    return this.desynced.size;
  }

  isDesynced(clientID: ClientID): boolean {
    return this.desynced.has(clientID);
  }

  // Called as each turn commits, with the number of turns now in the log.
  // Returns the tally for the turn due a check, or null when no check is due
  // or there is only one client, who has nobody to disagree with.
  check(turnsCommitted: number, active: readonly Client[]): DesyncCheck | null {
    if (active.length <= 1) {
      return null;
    }
    if (
      turnsCommitted % CHECK_INTERVAL !== 0 ||
      turnsCommitted < CHECK_INTERVAL
    ) {
      return null;
    }
    const turn = turnsCommitted - CHECK_INTERVAL;
    return { turn, ...findOutOfSyncClients(active, turn) };
  }

  // Records the clients a check found out of sync, and returns the ones that
  // have not been told yet — each is told once, however often it disagrees.
  record(outOfSync: readonly Client[]): Client[] {
    const toNotify: Client[] = [];
    for (const c of outOfSync) {
      this.desynced.add(c.clientID);
      if (this.notified.has(c.clientID)) {
        continue;
      }
      this.notified.add(c.clientID);
      toNotify.push(c);
    }
    return toNotify;
  }
}
