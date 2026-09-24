import { ByteReader } from "../../../zbin";

/**
 * Self-describing binary encoding for snapshot data.
 *
 * zbin is positional: a payload can only be read by the exact schema that
 * wrote it. Snapshots must stay readable across builds, so they need a format
 * that carries its own field names and types, letting an older record be
 * decoded as plain data and then migrated. This codec encodes plain values
 * (the shape JSON has, plus bigint, undefined, non-finite floats and typed
 * arrays) with a tag byte per value. Uint32Arrays, which are tile lists, are
 * delta-encoded. Strings, including object keys, are
 * interned: the first occurrence is written inline and later ones are a
 * varint back-reference, so repeated field names cost one or two bytes.
 *
 * Encoding is deterministic: equal values built in the same key order encode
 * to identical bytes, which the snapshot tests rely on.
 */

const enum Tag {
  Undefined = 0,
  Null = 1,
  False = 2,
  True = 3,
  Uint = 4,
  NegInt = 5,
  Float = 6,
  BigInt = 7,
  NewString = 8,
  StringRef = 9,
  Array = 10,
  Object = 11,
  TypedArray = 12,
  // Uint32Array as zigzag varint deltas. These are mostly tile lists in
  // conquest order, which is spatially coherent, so most deltas take one or
  // two bytes instead of four.
  DeltaU32 = 13,
}

type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

const TYPED_ARRAYS = [
  Int8Array,
  Uint8Array,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
] as const;

// Typed arrays are written as their raw bytes. Every platform the game runs
// on is little-endian; fail loudly rather than write unreadable snapshots.
if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
  throw new Error("snapshot codec requires a little-endian platform");
}

// Explicit mapping rather than indexing TYPED_ARRAYS with a stored value.
function typedArrayKind(kind: number): (typeof TYPED_ARRAYS)[number] {
  switch (kind) {
    case 0:
      return Int8Array;
    case 1:
      return Uint8Array;
    case 2:
      return Int16Array;
    case 3:
      return Uint16Array;
    case 4:
      return Int32Array;
    case 5:
      return Uint32Array;
    case 6:
      return Float32Array;
    case 7:
      return Float64Array;
    default:
      throw new SnapshotCodecError(`unknown typed array kind ${kind}`);
  }
}

export class SnapshotCodecError extends Error {
  override readonly name = "SnapshotCodecError";
}

const textEncoder = new TextEncoder();

// Growable writer. The varint, bigint and string layouts match zbin's
// ByteWriter so zbin's ByteReader decodes them; this one adds a bulk byte
// copy, which typed-array payloads (tile lists) need.
class SnapshotByteWriter {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  private pos = 0;

  private ensure(extra: number): void {
    if (this.pos + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(b: number): void {
    this.ensure(1);
    this.buf[this.pos++] = b;
  }

  uint(n: number): void {
    while (n >= 0x80) {
      this.u8((n % 0x80) + 0x80);
      n = Math.floor(n / 0x80);
    }
    this.u8(n);
  }

  f64(n: number): void {
    this.ensure(8);
    this.view.setFloat64(this.pos, n, true);
    this.pos += 8;
  }

  // Zigzag LEB128, as zbin writes bigints.
  bigint(n: bigint): void {
    let u = n < 0n ? -2n * n - 1n : 2n * n;
    while (u >= 0x80n) {
      this.u8(Number(u & 0x7fn) | 0x80);
      u >>= 7n;
    }
    this.u8(Number(u));
  }

  str(s: string): void {
    const bytes = textEncoder.encode(s);
    this.uint(bytes.length);
    this.bytes(bytes);
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

export function encodeSnapshotValue(value: unknown): Uint8Array {
  const w = new SnapshotByteWriter();
  const strings = new Map<string, number>();

  const writeString = (s: string) => {
    const idx = strings.get(s);
    if (idx !== undefined) {
      w.u8(Tag.StringRef);
      w.uint(idx);
      return;
    }
    strings.set(s, strings.size);
    w.u8(Tag.NewString);
    w.str(s);
  };

  const write = (v: unknown, path: string): void => {
    switch (typeof v) {
      case "undefined":
        w.u8(Tag.Undefined);
        return;
      case "boolean":
        w.u8(v ? Tag.True : Tag.False);
        return;
      case "number":
        if (Number.isSafeInteger(v) && !Object.is(v, -0)) {
          if (v >= 0) {
            w.u8(Tag.Uint);
            w.uint(v);
          } else {
            w.u8(Tag.NegInt);
            w.uint(-v - 1);
          }
        } else {
          w.u8(Tag.Float);
          w.f64(v);
        }
        return;
      case "bigint":
        w.u8(Tag.BigInt);
        w.bigint(v);
        return;
      case "string":
        writeString(v);
        return;
      case "object": {
        if (v === null) {
          w.u8(Tag.Null);
          return;
        }
        if (Array.isArray(v)) {
          w.u8(Tag.Array);
          w.uint(v.length);
          for (let i = 0; i < v.length; i++) write(v[i], path);
          return;
        }
        if (v instanceof Uint32Array) {
          w.u8(Tag.DeltaU32);
          w.uint(v.length);
          let prev = 0;
          for (let i = 0; i < v.length; i++) {
            const d = v[i] - prev;
            w.uint(d < 0 ? -2 * d - 1 : 2 * d);
            prev = v[i];
          }
          return;
        }
        if (ArrayBuffer.isView(v)) {
          const kind = TYPED_ARRAYS.findIndex(
            (C) => (v as TypedArray).constructor === C,
          );
          if (kind === -1) {
            throw new SnapshotCodecError(
              `${path}: unsupported binary view ${v.constructor.name}`,
            );
          }
          w.u8(Tag.TypedArray);
          w.u8(kind);
          w.uint(v.byteLength);
          w.bytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
          return;
        }
        const proto = Object.getPrototypeOf(v);
        if (proto !== Object.prototype && proto !== null) {
          throw new SnapshotCodecError(
            `${path}: snapshot data must be plain; got ${proto?.constructor?.name ?? "unknown"}`,
          );
        }
        const keys = Object.keys(v);
        w.u8(Tag.Object);
        w.uint(keys.length);
        for (const k of keys) {
          writeString(k);
          write((v as Record<string, unknown>)[k], `${path}.${k}`);
        }
        return;
      }
      default:
        throw new SnapshotCodecError(`${path}: cannot encode a ${typeof v}`);
    }
  };

  write(value, "$");
  return w.finish();
}

export function decodeSnapshotValue(bytes: Uint8Array): unknown {
  const r = new ByteReader(bytes);
  const strings: string[] = [];

  const readString = (tag: number): string => {
    if (tag === Tag.NewString) {
      const s = r.str();
      strings.push(s);
      return s;
    }
    if (tag === Tag.StringRef) {
      const idx = r.uint();
      if (idx >= strings.length) {
        throw new SnapshotCodecError(`unknown string reference ${idx}`);
      }
      return strings[idx];
    }
    throw new SnapshotCodecError(`expected a string, got tag ${tag}`);
  };

  const read = (): unknown => {
    const tag = r.u8();
    switch (tag) {
      case Tag.Undefined:
        return undefined;
      case Tag.Null:
        return null;
      case Tag.False:
        return false;
      case Tag.True:
        return true;
      case Tag.Uint:
        return r.uint();
      case Tag.NegInt:
        return -r.uint() - 1;
      case Tag.Float:
        return r.f64();
      case Tag.BigInt:
        return r.bigint();
      case Tag.NewString:
      case Tag.StringRef:
        return readString(tag);
      case Tag.Array: {
        const n = r.uint();
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = read();
        return out;
      }
      case Tag.Object: {
        const n = r.uint();
        const out: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) {
          const k = readString(r.u8());
          // Snapshots can be hand-edited or corrupt: a "__proto__" key would
          // replace the object's prototype instead of adding a field.
          if (k === "__proto__") {
            throw new SnapshotCodecError("invalid object key __proto__");
          }
          out[k] = read();
        }
        return out;
      }
      case Tag.DeltaU32: {
        const n = r.uint();
        if (n > r.remaining) {
          throw new SnapshotCodecError("truncated tile list");
        }
        const out = new Uint32Array(n);
        let prev = 0;
        for (let i = 0; i < n; i++) {
          const z = r.uint();
          const v = prev + (z % 2 === 0 ? z / 2 : -(z + 1) / 2);
          if (v < 0 || v > 0xffffffff) {
            throw new SnapshotCodecError("tile list value out of range");
          }
          out[i] = v;
          prev = v;
        }
        return out;
      }
      case Tag.TypedArray: {
        const C = typedArrayKind(r.u8());
        const byteLength = r.uint();
        if (byteLength % C.BYTES_PER_ELEMENT !== 0) {
          throw new SnapshotCodecError(`misaligned ${C.name} payload`);
        }
        // Copy so the result is aligned and does not pin the input buffer.
        const copy = r.readBytes(byteLength).slice();
        return new C(copy.buffer, 0, byteLength / C.BYTES_PER_ELEMENT);
      }
      default:
        throw new SnapshotCodecError(`unknown tag ${tag}`);
    }
  };

  const value = read();
  r.expectEnd();
  return value;
}
