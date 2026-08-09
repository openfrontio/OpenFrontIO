import { Colord, extend, LabaColor } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";
import { PseudoRandom } from "../../core/PseudoRandom";
import { simpleHash } from "../../core/Util";
import { deltaE2000 } from "./ColorDistance";
import { generateCandidateColors } from "./ColorGenerator";
import { Observer, observerViews } from "./ColorVision";

extend([lchPlugin]);
extend([labPlugin]);

/** What to do once every candidate colour has been handed out. */
export type ExhaustionPolicy = "generate" | "recycle";

export interface ColorAllocatorOptions {
  /**
   * Vision models a colour must stay distinct under. A candidate is scored by
   * its *worst* separation across all of them. Defaults to normal vision only,
   * which reproduces the previous behaviour.
   */
  observers?: Observer[];
  /**
   * Minimum ΔE2000 (0–100) a curated colour must reach before the allocator
   * stops trusting the curated palettes and synthesises a colour instead.
   * 0 keeps the curated palettes in use until they are exhausted.
   */
  distinctnessFloor?: number;
  /** Behaviour once every candidate is used. Defaults to "generate". */
  onExhausted?: ExhaustionPolicy;
}

/** A candidate colour, its appearance per observer, and its cached score. */
interface Candidate {
  color: Colord;
  /**
   * LAB coordinates of the colour as each observer sees it, converted once at
   * construction. Allocation compares one colour against thousands of
   * candidates, so converting per comparison would dominate the cost.
   */
  labs: LabaColor[];
  /**
   * Smallest distance to any already-assigned colour, across all observers.
   * Maintained incrementally so allocation costs O(candidates) rather than
   * O(candidates * assigned).
   */
  nearest: number;
  used: boolean;
}

/**
 * Assigns a stable, visually distinct colour to each id.
 *
 * Candidates are drawn from the theme's primary palette first, then its
 * fallback palette, and finally — only if neither can supply a colour that
 * clears `distinctnessFloor` — from colours generated on the fly. A colour is
 * never handed out twice unless `onExhausted` is "recycle".
 *
 * Theme-agnostic: it knows nothing about teams or palettes. A theme supplies
 * the pools and owns any team-colour logic.
 */
export class ColorAllocator {
  private readonly observers: Observer[];
  private readonly distinctnessFloor: number;
  private readonly onExhausted: ExhaustionPolicy;
  /** Curated tiers in preference order: primary palette, then fallback. */
  private readonly curated: Candidate[][];
  private generated: Candidate[] | null = null;
  private assigned = new Map<string, Colord>();

  constructor(
    colors: Colord[],
    fallback: Colord[],
    options: ColorAllocatorOptions = {},
  ) {
    this.observers = options.observers ?? ["normal"];
    this.distinctnessFloor = options.distinctnessFloor ?? 0;
    this.onExhausted = options.onExhausted ?? "generate";
    this.curated = [this.toCandidates(colors), this.toCandidates(fallback)];
  }

  /**
   * Return the colour assigned to `id`, allocating one on first request.
   * Assignments are stable for the allocator's lifetime.
   */
  assignColor(id: string): Colord {
    const existing = this.assigned.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const candidate = this.select(id);
    candidate.used = true;
    this.assigned.set(id, candidate.color);
    this.updateNearest(candidate);
    return candidate.color;
  }

  private toCandidates(colors: Colord[]): Candidate[] {
    return colors.map((color) => ({
      color,
      labs: this.toLabs(color),
      nearest: Infinity,
      used: false,
    }));
  }

  /** LAB coordinates of `color` under each observer this allocator checks. */
  private toLabs(color: Colord): LabaColor[] {
    return observerViews(color, this.observers).map((view) => view.toLab());
  }

  private select(id: string): Candidate {
    if (this.assigned.size === 0) {
      return this.seed(id);
    }

    // Prefer curated colours, in tier order, whenever one is good enough.
    for (const tier of this.curated) {
      const best = bestUnused(tier);
      if (best !== null && best.nearest >= this.distinctnessFloor) {
        return best;
      }
    }

    const curatedBest =
      bestUnused(this.curated[0]) ?? bestUnused(this.curated[1]);

    if (this.onExhausted === "recycle") {
      if (curatedBest !== null) {
        return curatedBest;
      }
      // Every curated colour is spoken for. Reopen the primary palette and
      // continue: hundreds of bots sharing a small palette is intended.
      for (const candidate of this.curated[0]) {
        candidate.used = false;
      }
      return bestUnused(this.curated[0])!;
    }

    const generatedBest = bestUnused(this.materialiseGenerated());
    if (curatedBest === null) {
      return generatedBest!;
    }
    if (generatedBest === null) {
      return curatedBest;
    }
    return generatedBest.nearest >= curatedBest.nearest
      ? generatedBest
      : curatedBest;
  }

  /**
   * First colour of a game: chosen pseudo-randomly from the primary palette so
   * that a given id lands on the same colour every time, as before.
   */
  private seed(id: string): Candidate {
    const primary = this.curated[0].filter((candidate) => !candidate.used);
    const fallback = this.curated[1].filter((candidate) => !candidate.used);
    const available =
      primary.length > 0
        ? primary
        : fallback.length > 0
          ? fallback
          : this.materialiseGenerated().filter((candidate) => !candidate.used);
    const random = new PseudoRandom(simpleHash(id));
    return available[random.nextInt(0, available.length)];
  }

  /**
   * Build the generated candidate set on first use, scoring it against
   * everything already assigned so it enters the pool fairly.
   */
  private materialiseGenerated(): Candidate[] {
    if (this.generated === null) {
      this.generated = this.toCandidates(generateCandidateColors());
      for (const color of this.assigned.values()) {
        const labs = this.toLabs(color);
        for (const candidate of this.generated) {
          candidate.nearest = Math.min(
            candidate.nearest,
            distance(candidate.labs, labs),
          );
        }
      }
    }
    return this.generated;
  }

  /** Fold a newly assigned colour into every candidate's cached score. */
  private updateNearest(assigned: Candidate): void {
    const tiers: Candidate[][] = [...this.curated];
    if (this.generated !== null) {
      tiers.push(this.generated);
    }
    for (const tier of tiers) {
      for (const candidate of tier) {
        if (candidate.used) {
          continue;
        }
        candidate.nearest = Math.min(
          candidate.nearest,
          distance(candidate.labs, assigned.labs),
        );
      }
    }
  }
}

/** Highest-scoring unused candidate in a tier, or null if none remain. */
function bestUnused(tier: Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const candidate of tier) {
    if (candidate.used) {
      continue;
    }
    if (best === null || candidate.nearest > best.nearest) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Worst-case ΔE2000 between two colours across every observer, on the 0–100
 * scale. Both operands are already in LAB, so no colour conversion happens
 * here — this runs once per candidate per allocation.
 */
function distance(a: LabaColor[], b: LabaColor[]): number {
  let worst = Infinity;
  for (let i = 0; i < a.length; i++) {
    const d = deltaE2000(a[i], b[i]);
    if (d < worst) {
      worst = d;
    }
  }
  return worst;
}

/**
 * Index of the available color that is most perceptually different from the
 * already-assigned colors (the one whose nearest assigned neighbor is farthest
 * away, by delta-E 2000). Throws if no colors have been assigned yet.
 */
export function selectDistinctColorIndex(
  availableColors: Colord[],
  assignedColors: Colord[],
): number {
  if (assignedColors.length === 0) {
    throw new Error("No assigned colors");
  }

  let maxDeltaE = 0;
  let maxIndex = 0;

  for (let i = 0; i < availableColors.length; i++) {
    let nearest = Infinity;
    for (const assigned of assignedColors) {
      // colord's lab plugin .delta() is CIEDE2000 normalized to 0..1; only
      // relative magnitudes matter here.
      nearest = Math.min(nearest, availableColors[i].delta(assigned));
    }
    if (nearest > maxDeltaE) {
      maxDeltaE = nearest;
      maxIndex = i;
    }
  }
  return maxIndex;
}
