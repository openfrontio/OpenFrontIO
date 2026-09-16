// Which member of a lobby pool a player belongs to. See PoolConfigSchema for
// what a pool is and why it is shaped this way.
//
// Server-side, not core: this is lobby admission, not simulation. It never
// runs in the sim worker, and what it needs is the same answer on this server
// across calls — not lockstep reproducibility between clients.

import { GameID, PoolConfig } from "../core/Schemas";
import { simpleHash } from "../core/Util";

export function poolIndexFor(key: string, size: number): number {
  return simpleHash(key) % size;
}

// The pool id is mixed into the key so a player is not pinned to the same
// ordinal in every pool they meet: hashing identity alone would send the same
// people to member 0 of every equally-sized pool.
export function poolTargetFor(
  pool: PoolConfig,
  key: string,
  selfId: GameID,
): GameID | null {
  const { siblings } = pool;
  // The schema requires a member, so this only guards a pool built in code.
  if (siblings.length === 0) return null;
  const target = siblings[poolIndexFor(`${pool.id}:${key}`, siblings.length)];
  return target === selfId ? null : target;
}
