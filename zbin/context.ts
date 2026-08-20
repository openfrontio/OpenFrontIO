// zbin serialization context: named dictionaries that map frequently repeated
// strings (e.g. player ids) to single-byte indexes on the wire.
//
// Sync model: both peers must build identical tables from data they already
// share (e.g. the player roster in the game-start message) — there is no
// on-wire learning. Values missing from a table are encoded inline via an
// escape byte, so an unmapped value is always correct, just not compact.

// Index 255 is the inline-escape marker, so tables hold at most 255 entries
// (indexes 0..254).
export const ESCAPE_BYTE = 0xff;
export const MAX_MAPPING_SIZE = 255;

interface Table {
  max: number;
  toIndex: Map<string, number>;
  values: string[];
}

export class ZbContext {
  private tables = new Map<string, Table>();

  // Declare a dictionary. `max` caps how many values get indexes; further
  // assigns are ignored (those values encode inline).
  mapping(name: string, opts: { max?: number } = {}): this {
    const max = opts.max ?? MAX_MAPPING_SIZE;
    if (!Number.isInteger(max) || max < 1 || max > MAX_MAPPING_SIZE) {
      throw new RangeError(
        `zbin mapping "${name}": max must be an integer in [1, ${MAX_MAPPING_SIZE}]`,
      );
    }
    if (this.tables.has(name)) {
      throw new Error(`zbin mapping "${name}" already declared`);
    }
    this.tables.set(name, { max, toIndex: new Map(), values: [] });
    return this;
  }

  // Add a value to a table. Returns its index, or -1 if the table is full.
  // Assign order is part of the wire contract: both peers must assign the
  // same values in the same order.
  assign(name: string, value: string): number {
    const t = this.table(name);
    const existing = t.toIndex.get(value);
    if (existing !== undefined) return existing;
    if (t.values.length >= t.max) return -1;
    const idx = t.values.length;
    t.values.push(value);
    t.toIndex.set(value, idx);
    return idx;
  }

  assignAll(name: string, values: Iterable<string>): this {
    for (const v of values) this.assign(name, v);
    return this;
  }

  // Encoder lookup. Undefined when the value (or the whole table) is unmapped,
  // in which case the value is encoded inline.
  indexOf(name: string, value: string): number | undefined {
    return this.tables.get(name)?.toIndex.get(value);
  }

  // Decoder lookup. Undefined means the peer referenced an index this side
  // never assigned — a protocol error surfaced by the codec.
  valueAt(name: string, index: number): string | undefined {
    return this.tables.get(name)?.values[index];
  }

  size(name: string): number {
    return this.table(name).values.length;
  }

  private table(name: string): Table {
    const t = this.tables.get(name);
    if (t === undefined) throw new Error(`zbin mapping "${name}" not declared`);
    return t;
  }
}
