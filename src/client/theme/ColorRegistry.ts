import { Colord, LabaColor } from "colord";
import { deltaE2000 } from "./ColorDistance";
import { Observer, observerViews } from "./ColorVision";

/** A colour under consideration, with its cached distance to what's in play. */
export interface Candidate {
  color: Colord;
  /** The colour as each observer sees it, converted once. */
  labs: LabaColor[];
  /**
   * Smallest distance to any colour already in play, across all observers.
   * Maintained incrementally so each allocation costs O(candidates) rather
   * than O(candidates * assigned).
   */
  nearest: number;
  used: boolean;
}

/**
 * Worst-case ΔE2000 between two colours across every observer.
 *
 * Both arrays must come from the same observer list, in the same order — they
 * are compared index by index. "Worst" here means the *smallest* separation,
 * which is the right reading for a distinctness metric: a pair is only as
 * distinguishable as the observer who can least tell them apart.
 */
export function distance(first: LabaColor[], second: LabaColor[]): number {
  let worst = Infinity;
  for (let i = 0; i < first.length; i++) {
    const value = deltaE2000(first[i], second[i]);
    if (value < worst) {
      worst = value;
    }
  }
  return worst;
}

/**
 * The colours in play for one game, shared by every allocator that draws from
 * them.
 *
 * Players are drawn from separate palettes by type — human, nation, bot — but a
 * player looking at the map cannot tell those types apart; they just see
 * territories. Distinctness therefore has to be judged across all of them at
 * once. Allocators that share a registry compete for the same space, so a
 * nation can never be handed a colour that a human is already using.
 *
 * When no palette colour is far enough from what's in play, the registry
 * synthesises one from the LCH sequence in ColorGenerator.
 */
export class ColorRegistry {
  private readonly inPlay: Candidate[] = [];
  private readonly pools: Candidate[][] = [];

  constructor(
    readonly observers: Observer[],
    readonly distinctnessFloor: number,
  ) {}

  /** How many colours have been handed out. */
  get size(): number {
    return this.inPlay.length;
  }

  /** Wrap a colour with the per-observer LAB values scoring needs. */
  candidate(color: Colord): Candidate {
    return {
      color,
      labs: observerViews(color, this.observers).map((view) => view.toLab()),
      nearest: Infinity,
      used: false,
    };
  }

  /**
   * Track a pool so its scores stay current as colours are handed out. Pools
   * joining late are scored against everything already in play.
   */
  registerPool(pool: Candidate[]): void {
    this.pools.push(pool);
    for (const candidate of pool) {
      candidate.nearest = Math.min(
        candidate.nearest,
        this.distanceToInPlay(candidate.labs),
      );
    }
  }

  /** Lower every tracked pool's score against one colour now in play. */
  private refreshPools(against: Candidate): void {
    for (const pool of this.pools) {
      for (const other of pool) {
        if (other.used) {
          continue;
        }
        const value = distance(other.labs, against.labs);
        if (value < other.nearest) {
          other.nearest = value;
        }
      }
    }
  }

  /** Put a colour into play and refresh every tracked pool against it. */
  commit(candidate: Candidate): void {
    candidate.used = true;
    this.inPlay.push(candidate);
    this.refreshPools(candidate);
  }

  /**
   * Distance from a colour to the nearest colour already in play.
   *
   * `abortBelow` lets a caller comparing many candidates give up on one as soon
   * as it cannot beat the best so far. The result is then only a lower bound —
   * which is all a caller about to discard it needs. A candidate that survives
   * without aborting always carries its exact distance.
   */
  distanceToInPlay(labs: LabaColor[], abortBelow = -Infinity): number {
    let worst = Infinity;
    for (const candidate of this.inPlay) {
      const value = distance(labs, candidate.labs);
      if (value < worst) {
        worst = value;
        if (worst <= abortBelow) {
          return worst;
        }
      }
    }
    return worst;
  }

  /**
   * Treat colours as in play without assigning them to anyone.
   *
   * Bot palettes are handed out by hash rather than reserved, but bot
   * territories are still on the map — so humans and nations have to steer
   * clear of those colours even though no bot has claimed them yet.
   */
  reserve(colors: Colord[]): void {
    for (const color of colors) {
      const reserved = this.candidate(color);
      this.inPlay.push(reserved);
      // Refresh pools here too, so reserving works whatever order the
      // allocators happen to be constructed in.
      this.refreshPools(reserved);
    }
  }
}
