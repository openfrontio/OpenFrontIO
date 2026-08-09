import { Colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";
import { PseudoRandom } from "../../core/PseudoRandom";
import { simpleHash } from "../../core/Util";
import {
  ColorEnvelope,
  paletteEnvelope,
  sequenceColor,
} from "./ColorGenerator";
import { Candidate, ColorRegistry } from "./ColorRegistry";
import { Observer } from "./ColorVision";

/**
 * How many synthesised colours to keep available at a time.
 *
 * Sized against the largest public lobby (125) plus nations, with room to
 * discard crowded candidates. Scored once on creation and maintained
 * incrementally afterwards, so widening this costs a scan per allocation.
 */
const GENERATED_POOL_SIZE = 2048;

extend([lchPlugin]);
extend([labPlugin]);

/** How a pool of players competes for colours. */
export type AllocationPolicy = "distinct" | "shared";

export interface ColorAllocatorOptions {
  /**
   * Vision models a colour must stay distinct under. A candidate is scored by
   * its *worst* separation across all of them. Defaults to normal vision only.
   * Ignored when `registry` is supplied — the registry owns these.
   */
  observers?: Observer[];
  /**
   * Minimum ΔE2000 (0–100) a palette colour must reach before the allocator
   * stops trusting the palettes and synthesises one instead. Ignored when
   * `registry` is supplied.
   */
  distinctnessFloor?: number;
  /**
   * `"distinct"` (default) gives every id its own colour, competing with every
   * other allocator sharing the registry. `"shared"` hands out colours by
   * stable hash without reserving them — for pools where hundreds of players
   * are expected to share a small palette by design.
   */
  policy?: AllocationPolicy;
  /**
   * Distinctness state shared with other allocators. Supply one registry to
   * every allocator in a game so their colours cannot collide. Omitted, the
   * allocator gets a private registry and competes with nobody.
   */
  registry?: ColorRegistry;
}

/**
 * Assigns a stable colour to each id.
 *
 * Colours come from the primary palette first, then the fallback palette, and
 * finally — only when neither holds one far enough from the colours already in
 * play — from a colour synthesised by the registry. Assignments are stable for
 * the allocator's lifetime.
 *
 * Theme-agnostic: it knows nothing about teams or palettes. A theme supplies
 * the pools and owns any team-colour logic.
 */
export class ColorAllocator {
  private readonly registry: ColorRegistry;
  private readonly policy: AllocationPolicy;
  private readonly primary: Candidate[];
  private readonly fallback: Candidate[];
  /**
   * The LCH region this allocator's synthesised colours are drawn from, taken
   * from its primary palette so they stay in character with it.
   */
  private readonly envelope: ColorEnvelope;
  /** Synthesised colours, built on first need so ordinary lobbies never pay. */
  private generated: Candidate[] | null = null;
  private assigned = new Map<string, Colord>();

  constructor(
    colors: Colord[],
    fallback: Colord[],
    options: ColorAllocatorOptions = {},
  ) {
    this.registry =
      options.registry ??
      new ColorRegistry(
        options.observers ?? ["normal"],
        options.distinctnessFloor ?? 0,
      );
    this.policy = options.policy ?? "distinct";
    this.envelope = paletteEnvelope(colors);
    this.primary = colors.map((color) => this.registry.candidate(color));
    this.fallback = fallback.map((color) => this.registry.candidate(color));
    if (this.policy === "distinct") {
      this.registry.registerPool(this.primary);
      this.registry.registerPool(this.fallback);
    } else {
      // Nothing reserves these, but they will be on the map, so everyone else
      // has to keep away from them.
      this.registry.reserve(colors);
    }
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
    const color = this.policy === "shared" ? this.share(id) : this.allocate(id);
    this.assigned.set(id, color);
    return color;
  }

  /**
   * Stable hash into the primary palette, reserving nothing. Hundreds of bots
   * sharing a handful of colours is intended: giving each one a colour of its
   * own would crowd out the players it matters most to tell apart, and cost
   * far more than it is worth.
   */
  private share(id: string): Colord {
    return this.primary[simpleHash(id) % this.primary.length].color;
  }

  private allocate(id: string): Colord {
    const candidate = this.select(id);
    this.registry.commit(candidate);
    return candidate.color;
  }

  private select(id: string): Candidate {
    if (this.registry.size === 0) {
      return this.seed(id);
    }

    // Prefer palette colours, primary before fallback, while one is good enough.
    for (const pool of [this.primary, this.fallback]) {
      const best = bestUnused(pool);
      if (best !== null && best.nearest >= this.registry.distinctnessFloor) {
        return best;
      }
    }

    const curated = bestUnused(this.primary) ?? bestUnused(this.fallback);
    const generated = this.generate();
    if (curated !== null && curated.nearest >= generated.nearest) {
      return curated;
    }
    return generated;
  }

  /**
   * The roomiest synthesised colour available, drawn from this allocator's own
   * envelope so it stays in character with its palette.
   *
   * The pool is built once, on first need, and registered with the registry so
   * its scores are maintained incrementally — the same colour is never
   * re-scored against the same neighbour twice.
   */
  private generate(): Candidate {
    if (this.generated === null) {
      this.generated = [];
      for (let index = 0; index < GENERATED_POOL_SIZE; index++) {
        this.generated.push(
          this.registry.candidate(sequenceColor(index, this.envelope)),
        );
      }
      this.registry.registerPool(this.generated);
    }
    let best: Candidate | null = null;
    for (const candidate of this.generated) {
      // Never hand back a colour already in play: that would put two players in
      // the same colour, the defect this exists to prevent. Sequence colours
      // round to 8-bit sRGB, so exact repeats are possible.
      if (candidate.used || candidate.nearest <= 0) {
        continue;
      }
      if (best === null || candidate.nearest > best.nearest) {
        best = candidate;
      }
    }
    if (best !== null) {
      return best;
    }
    // Pool wholly used or wholly crowded — extend it and take the newcomer.
    const grown = this.registry.candidate(
      sequenceColor(this.generated.length, this.envelope),
    );
    grown.nearest = this.registry.distanceToInPlay(grown.labs);
    this.generated.push(grown);
    return grown;
  }

  /**
   * First colour of a game: chosen pseudo-randomly from the primary palette so
   * a given id lands on the same colour every time.
   */
  private seed(id: string): Candidate {
    const available = this.primary.filter((candidate) => !candidate.used);
    const source =
      available.length > 0
        ? available
        : this.fallback.filter((candidate) => !candidate.used);
    if (source.length === 0) {
      return this.generate();
    }
    const random = new PseudoRandom(simpleHash(id));
    return source[random.nextInt(0, source.length)];
  }
}

/** Highest-scoring unused candidate in a pool, or null if none remain. */
function bestUnused(pool: Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const candidate of pool) {
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
