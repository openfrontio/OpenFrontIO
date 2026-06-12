export class PseudoRandom {
  // sfc32 state. All operations are 32-bit integer ops, so sequences are
  // identical across platforms.
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  private static readonly POW36_8 = Math.pow(36, 8); // Pre-compute 36^8

  constructor(seed: number) {
    // The seed is truncated to 32 bits: seeds congruent mod 2^32 produce
    // identical streams, and fractional parts are discarded.
    // Expand the numeric seed into four state words with splitmix32.
    let h = seed | 0;
    const split = () => {
      h = (h + 0x9e3779b9) | 0;
      let t = h ^ (h >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      return (t ^ (t >>> 15)) | 0;
    };
    this.s0 = split();
    this.s1 = split();
    this.s2 = split();
    this.s3 = split();
    // Warm up to diffuse low-entropy seeds (sequential ints, small numbers).
    for (let i = 0; i < 12; i++) {
      this.next();
    }
  }

  // Generates the next pseudorandom number between 0 and 1.
  next(): number {
    const t = (((this.s0 + this.s1) | 0) + this.s3) | 0;
    this.s3 = (this.s3 + 1) | 0;
    this.s0 = this.s1 ^ (this.s1 >>> 9);
    this.s1 = (this.s2 + (this.s2 << 3)) | 0;
    this.s2 = (this.s2 << 21) | (this.s2 >>> 11);
    this.s2 = (this.s2 + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  // Generates a random integer between min (inclusive) and max (exclusive).
  nextInt(min: number, max: number): number {
    const lo = Math.floor(min);
    const hi = Math.floor(max);
    return Math.floor(this.next() * (hi - lo)) + lo;
  }

  // Generates a random float between min (inclusive) and max (exclusive).
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  // Generates a random ID (8 characters, alphanumeric).
  nextID(): string {
    return Math.floor(this.next() * PseudoRandom.POW36_8)
      .toString(36)
      .padStart(8, "0");
  }

  // Selects a random element from an array.
  randElement<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error("array must not be empty");
    }
    return arr[this.nextInt(0, arr.length)];
  }

  // Selects a random element from a set.
  randFromSet<T>(set: Set<T>): T {
    const size = set.size;
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
    return this.nextInt(0, odds) === 0;
  }

  // Returns a shuffled copy of the array using Fisher-Yates algorithm.
  shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}
