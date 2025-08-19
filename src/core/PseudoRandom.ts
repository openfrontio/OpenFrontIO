import seedrandom from "seedrandom";

export class PseudoRandom {
  private readonly rng: seedrandom.PRNG;

  private static readonly POW36_8 = Math.pow(36, 8); // Pre-compute 36^8

  constructor(seed: number) {
    this.rng = seedrandom(String(seed));
  }

  // Generates the next pseudorandom number between 0 and 1.
  next(): number {
    return this.rng();
  }

  // Generates a random integer between min (inclusive) and max (exclusive).
  nextInt(min: number, max: number): number {
    return Math.floor(this.rng() * (max - min)) + min;
  }

  // Generates a random float between min (inclusive) and max (exclusive).
  nextFloat(min: number, max: number): number {
    return this.rng() * (max - min) + min;
  }

  // Generates a random ID (8 characters, alphanumeric).
  nextID(): string {
    return Math.floor(this.rng() * PseudoRandom.POW36_8)
      .toString(36)
      .padStart(8, "0");
  }

  // Selects a random element from an array.
  randElement<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error("array must not be empty");
    }
    return arr[Math.floor(this.rng() * arr.length)];
  }

  // Selects a random element from a set.
  randFromSet<T>(set: Set<T>): T {
    const { size } = set;
    if (size === 0) {
      throw new Error("set must not be empty");
    }

    const index = this.nextInt(0, size);
    let i = 0;
    for (const item of set) {
      if (i === index) {
        return item;
      }
      i++;
    }

    // This should never happen
    throw new Error("Unexpected error selecting element from set");
  }

  // Returns true with probability 1/odds.
  chance(odds: number): boolean {
    return Math.floor(this.rng() * odds) === 0;
  }

  // Returns a shuffled copy of the array using Fisher-Yates algorithm.
  shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i >= 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}
