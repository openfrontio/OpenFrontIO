// zbin serialization context: named dictionaries that map frequently repeated
// strings (e.g. player ids) to small varint indexes on the wire.
//
// Sync model: both peers must build identical tables from data they already
// share (e.g. the player roster in the game-start message) — there is no
// on-wire learning. Values missing from a table are encoded inline via an
// escape byte, so an unmapped value is always correct, just not compact.
//
// Tables are seeded from runtime data, so "both peers run the same commit"
// does NOT guarantee they agree. Two tables of equal length in different
// orders decode every index to the wrong value with no error, so peers should
// compare `fingerprint(name)` out-of-band before relying on a table.

// On the wire an index rides as varint(index + 1); varint 0 is the
// inline-escape marker. Indexes 0..126 cost one byte, 127..16382 cost two.
// The size cap is not a wire constant — it just bounds table memory.
export const MAX_MAPPING_SIZE = 65535;

export interface ZbTable {
  max: number;
  toIndex: Map<string, number>;
  values: string[];
}

export class ZbContext {
  private tables = new Map<string, ZbTable>();

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

  hasMapping(name: string): boolean {
    return this.tables.has(name);
  }

  // Direct table handle so hot-path codecs can resolve the name once per
  // context instead of once per encoded value.
  tableFor(name: string): ZbTable | undefined {
    return this.tables.get(name);
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

  // Order-sensitive digest of a table's contents (FNV-1a). Peers that exchange
  // this and compare it turn an otherwise-silent ordering mismatch into a
  // detectable one.
  fingerprint(name: string): number {
    let h = 0x811c9dc5;
    for (const v of this.table(name).values) {
      for (let i = 0; i < v.length; i++) {
        h ^= v.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      h ^= 0xff; // value separator, so ["ab","c"] and ["a","bc"] differ
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  private table(name: string): ZbTable {
    const t = this.tables.get(name);
    if (t === undefined) throw new Error(`zbin mapping "${name}" not declared`);
    return t;
  }
}
