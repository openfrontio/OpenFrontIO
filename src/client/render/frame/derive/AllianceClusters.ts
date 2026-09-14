import type { PlayerState } from "../../types";

/**
 * Compute alliance clusters via union-find.
 * Returns a map of `playerSmallID → clusterRootID`.
 * Used by SAM radius pass to color allies as a group.
 */
export function computeAllianceClusters(
  players: ReadonlyMap<number, PlayerState>,
): Map<number, number> {
  const parent = new Map<number, number>();

  function find(x: number): number {
    while (parent.get(x) !== x) {
      const p = parent.get(x)!;
      parent.set(x, parent.get(p)!);
      x = p;
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  for (const ps of players.values()) {
    if (ps.smallID > 0) parent.set(ps.smallID, ps.smallID);
  }

  for (const ps of players.values()) {
    if (!ps.allies || ps.smallID <= 0) continue;
    for (const allyID of ps.allies) {
      if (parent.has(allyID)) union(ps.smallID, allyID);
    }
  }

  const result = new Map<number, number>();
  for (const id of parent.keys()) {
    result.set(id, find(id));
  }
  return result;
}
