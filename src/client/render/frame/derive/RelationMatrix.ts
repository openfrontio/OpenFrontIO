import type { PlayerState, PlayerStatic } from "../../types";

const RELATION_SIZE = 1024;
const RELATION_NEUTRAL = 0;
const RELATION_FRIENDLY = 1;
const RELATION_EMBARGO = 2;

/** Reusable matrix buffer — one allocation, rewritten each frame. */
const matrix = new Uint8Array(RELATION_SIZE * RELATION_SIZE);

export interface RelationMatrixResult {
  matrix: Uint8Array;
  size: number;
}

/**
 * Build a relationship matrix from player alliance, embargo, and team data.
 * Indexed by `[ownerA * size + ownerB]` → 0=neutral, 1=friendly, 2=embargo.
 * Embargo overrides friendly (matching game priority).
 *
 * @param teams  Optional smallID→team map. Same-team players are marked friendly.
 */
export function buildRelationMatrix(
  players: ReadonlyMap<number, PlayerState>,
  teams?: ReadonlyMap<number, string>,
): RelationMatrixResult {
  matrix.fill(RELATION_NEUTRAL);

  // Teammates — mark same-team pairs as friendly (before embargoes, which override)
  if (teams && teams.size > 0) {
    const byTeam = new Map<string, number[]>();
    for (const [sid, team] of teams) {
      if (sid <= 0 || sid >= RELATION_SIZE) continue;
      let bucket = byTeam.get(team);
      if (!bucket) {
        bucket = [];
        byTeam.set(team, bucket);
      }
      bucket.push(sid);
    }
    for (const members of byTeam.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i]!,
            b = members[j]!;
          matrix[a * RELATION_SIZE + b] = RELATION_FRIENDLY;
          matrix[b * RELATION_SIZE + a] = RELATION_FRIENDLY;
        }
      }
    }
  }

  // Alliances
  for (const ps of players.values()) {
    const sid = ps.smallID;
    if (sid <= 0 || sid >= RELATION_SIZE) continue;

    if (ps.allies) {
      for (const allyID of ps.allies) {
        if (allyID > 0 && allyID < RELATION_SIZE) {
          const ab = sid * RELATION_SIZE + allyID;
          const ba = allyID * RELATION_SIZE + sid;
          if (matrix[ab]! < RELATION_FRIENDLY) matrix[ab] = RELATION_FRIENDLY;
          if (matrix[ba]! < RELATION_FRIENDLY) matrix[ba] = RELATION_FRIENDLY;
        }
      }
    }

    if (ps.embargoes) {
      for (const eID of ps.embargoes) {
        if (eID > 0 && eID < RELATION_SIZE) {
          matrix[sid * RELATION_SIZE + eID] = RELATION_EMBARGO;
          matrix[eID * RELATION_SIZE + sid] = RELATION_EMBARGO;
        }
      }
    }
  }

  return { matrix, size: RELATION_SIZE };
}

/** Build a smallID→team map from a player list. Skips players with no team. */
export function buildTeamMap(
  players: readonly PlayerStatic[],
): ReadonlyMap<number, string> {
  const m = new Map<number, string>();
  for (const p of players) {
    if (p.team !== null) m.set(p.smallID, p.team);
  }
  return m;
}
