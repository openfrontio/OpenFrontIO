import { Game } from "./Game";
import { TileRef } from "./GameMap";

/**
 * Shared per-game traversal scratch: a generation-stamped visited array (one
 * slot per tile) plus a reusable stack, so BFS/DFS passes over the map
 * allocate nothing per query. A single scratch is shared by all traversal
 * users of a game — the visited array alone is ~32 MB on the largest maps,
 * so each user keeping its own would multiply that cost.
 *
 * Usage contract: call bumpTraversalGeneration() at the start of a traversal
 * pass and treat visited[t] === gen as "seen this pass". A pass must run to
 * completion synchronously — starting another pass (by any user) invalidates
 * the previous generation's marks. The simulation is single-threaded and no
 * current traversal triggers another mid-pass.
 */
export interface TileTraversalScratch {
  visited: Uint32Array;
  stack: TileRef[];
  /** Current generation — advance via bumpTraversalGeneration(), not directly. */
  gen: number;
}

const scratches = new WeakMap<Game, TileTraversalScratch>();

export function tileTraversalScratch(game: Game): TileTraversalScratch {
  const totalTiles = game.width() * game.height();
  let scratch = scratches.get(game);
  if (!scratch || scratch.visited.length < totalTiles) {
    scratch = { visited: new Uint32Array(totalTiles), stack: [], gen: 0 };
    scratches.set(game, scratch);
  }
  return scratch;
}

/** Starts a new traversal pass and returns its generation stamp. */
export function bumpTraversalGeneration(scratch: TileTraversalScratch): number {
  scratch.gen++;
  if (scratch.gen === 0xffffffff) {
    scratch.visited.fill(0);
    scratch.gen = 1;
  }
  return scratch.gen;
}
