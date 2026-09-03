// zbin — compact binary serialization for zod schemas.
//
// Every builder here returns a REAL zod schema (usable with z.infer,
// .optional(), plain-zod composition, JSON paths) whose binary codec is
// registered in a WeakMap side table keyed by schema INSTANCE. Root builders
// (object, discriminatedUnion, union, stamped) additionally attach
// serialize/parseBytes/decodeBytesUnvalidated methods to that instance.
//
// Most plain zod schemas are auto-derived when reachable from a zb root:
// strings, booleans, bigints, literals, enums, objects, arrays, records,
// tuples, (discriminated) unions, lazy, and optional/nullable/default
// wrappers. Only genuinely ambiguous or exotic spots need an explicit builder:
//   - numbers: JSON can't say int vs float, so use zb.uint/int/float
//   - dictionary-compressed ids: zb.mapped
//   - complex cold subtrees: zb.json (length-prefixed JSON escape hatch)
//   - intersections over a discriminated union: zb.stamped
//
// Wire-format invariants. There is NO version byte and no field tags: a zbin
// payload is a bare positional byte stream, so the schema IS the format. All
// peers are expected to run the same build; skew between builds can silently
// mis-decode rather than fail. The invariants are:
//   - object field order = shape declaration order
//   - enum/union ordinals = declaration order
//   - optional/nullable/boolean fields live in a leading presence-bit header
// tests/zbin/golden.test.ts pins these as hex vectors, so an accidental
// layout change shows up as a failing test rather than a decode bug.

import { z } from "zod";
import {
  ByteReader,
  ByteWriter,
  MAX_DECODE_ITEMS,
  ZbDecodeError,
  ZbEncodeError,
} from "./bytes";
import { ZbContext, type ZbTable } from "./context";

export {
  ByteReader,
  ByteWriter,
  MAX_BIGINT_BITS,
  MAX_DECODE_DEPTH,
  MAX_DECODE_ITEMS,
  ZbDecodeError,
  ZbEncodeError,
} from "./bytes";
export { MAX_MAPPING_SIZE, ZbContext } from "./context";
export { bigint_ as bigint };

export interface Codec<T = any> {
  enc(w: ByteWriter, v: T, ctx: ZbContext | undefined): void;
  dec(r: ByteReader, ctx: ZbContext | undefined): T;
  // Whether a value of this codec can occupy zero bytes, carried as a byte
  // count for convenience when composing (an object sums its fields'). readCount
  // uses only whether this is NONZERO — to bound attacker-supplied collection
  // counts against the remaining input — so it need not be a tight lower bound;
  // OVER-stating it is harmless. Zero is legitimate (literals, all-literal
  // objects) and is what makes the separate per-message element budget necessary.
  minBytes: number;
}

// Codecs registered by an explicit zb.* builder, and codecs derived from a
// plain zod def. They are kept apart so that deriving a codec for a schema can
// never be mistaken for the caller having registered one — which previously
// made the wire format depend on module construction order.
const explicit = new WeakMap<z.ZodType, Codec>();
const derivedCache = new WeakMap<z.ZodType, Codec>();

function register<S extends z.ZodType>(schema: S, codec: Codec): S {
  if (derivedCache.has(schema)) {
    throw new Error(
      "zbin: this schema instance was already composed into a zb root with a " +
        "derived codec; register its codec before composing it",
    );
  }
  const prior = explicit.get(schema);
  if (prior !== undefined && prior !== codec) {
    throw new Error("zbin: this schema instance already has a codec");
  }
  explicit.set(schema, codec);
  return schema;
}

function defOf(schema: z.ZodType): any {
  return (schema as any)._zod.def;
}

function schemaError(path: string, msg: string): Error {
  return new Error(`zbin schema at ${path}: ${msg}`);
}

// ---------------------------------------------------------------------------
// Leaf codecs
// ---------------------------------------------------------------------------

const uintCodec: Codec<number> = {
  enc: (w, v) => w.uint(v),
  dec: (r) => r.uint(),
  minBytes: 1,
};

const intCodec: Codec<number> = {
  enc: (w, v) => w.int(v),
  dec: (r) => r.int(),
  minBytes: 1,
};

const floatCodec: Codec<number> = {
  enc: (w, v) => w.f64(v),
  dec: (r) => r.f64(),
  minBytes: 8,
};

const bigintCodec: Codec<bigint> = {
  enc: (w, v) => w.bigint(v),
  dec: (r) => r.bigint(),
  minBytes: 1,
};

const strCodec: Codec<string> = {
  enc: (w, v) => w.str(v),
  dec: (r) => r.str(),
  minBytes: 1,
};

// Standalone boolean (inside arrays etc.). Object fields pack booleans into
// the presence-bit header instead.
const boolByteCodec: Codec<boolean> = {
  enc: (w, v) => {
    if (typeof v !== "boolean") {
      throw new ZbEncodeError(`not an encodable boolean: ${String(v)}`);
    }
    w.u8(v ? 1 : 0);
  },
  dec: (r) => {
    const b = r.u8();
    if (b > 1) throw new ZbDecodeError(`invalid boolean byte ${b}`);
    return b === 1;
  },
  minBytes: 1,
};

function constCodec(value: unknown, path: string): Codec {
  return {
    enc: (_w, v) => {
      if (v !== value) {
        throw new ZbEncodeError(
          `${path}: expected literal ${String(value)}, got ${String(v)}`,
        );
      }
    },
    dec: () => value,
    minBytes: 0,
  };
}

function enumCodec(values: readonly unknown[], path: string): Codec {
  const toIndex = new Map<unknown, number>();
  values.forEach((v, i) => toIndex.set(v, i));
  if (toIndex.size !== values.length) {
    throw schemaError(
      path,
      "enum has duplicate values; ordinals are ambiguous",
    );
  }
  return {
    enc: (w, v) => {
      const idx = toIndex.get(v);
      if (idx === undefined) {
        throw new ZbEncodeError(`${path}: value ${String(v)} is not a member`);
      }
      w.uint(idx);
    },
    dec: (r) => {
      const idx = r.uint();
      if (idx >= values.length) {
        throw new ZbDecodeError(`${path}: enum ordinal ${idx} out of range`);
      }
      return values[idx];
    },
    minBytes: 1,
  };
}

function mappedCodec(name: string): Codec<string> {
  // One-slot memo: a context is normally per-connection and reused across many
  // values, so resolving the table name once per context avoids a Map lookup
  // on every encoded id.
  let lastCtx: ZbContext | undefined;
  let lastTable: ZbTable | undefined;
  const tableFor = (ctx: ZbContext | undefined): ZbTable | undefined => {
    if (ctx !== lastCtx) {
      lastCtx = ctx;
      lastTable = ctx?.tableFor(name);
    }
    return lastTable;
  };
  return {
    enc: (w, v, ctx) => {
      // Encoding without any context is legal (everything goes inline), but a
      // context that simply lacks this table means a typo'd mapping name —
      // otherwise it silently costs the compression this builder exists for.
      if (ctx !== undefined && !ctx.hasMapping(name)) {
        throw new ZbEncodeError(
          `zb.mapped("${name}"): no such mapping declared on this context`,
        );
      }
      // varint(index + 1); varint 0 escapes to an inline string.
      const idx = tableFor(ctx)?.toIndex.get(v);
      if (idx !== undefined) {
        w.uint(idx + 1);
      } else {
        w.u8(0);
        w.str(v);
      }
    },
    dec: (r, ctx) => {
      const n = r.uint();
      if (n === 0) return r.str();
      const value = tableFor(ctx)?.values[n - 1];
      if (value === undefined) {
        throw new ZbDecodeError(`unknown "${name}" dictionary index ${n - 1}`);
      }
      return value;
    },
    minBytes: 1,
  };
}

const jsonCodec: Codec = {
  enc: (w, v) => {
    let s: string;
    try {
      s = JSON.stringify(v);
    } catch (e) {
      // bigint and cyclic values throw; keep the uniform error contract.
      throw new ZbEncodeError("value is not JSON-serializable", { cause: e });
    }
    if (s === undefined) {
      throw new ZbEncodeError("value is not JSON-serializable");
    }
    w.str(s);
  },
  dec: (r) => {
    const s = r.str();
    try {
      // Drop __proto__ during parse: JSON.parse would make it an own property
      // that a later merge/assign could use to reach an object's prototype.
      return JSON.parse(s, (k, v) => (k === "__proto__" ? undefined : v));
    } catch (e) {
      // Uniform decode-error contract: corrupt input always surfaces as
      // ZbDecodeError, never a raw SyntaxError.
      throw new ZbDecodeError("invalid embedded JSON", { cause: e });
    }
  },
  minBytes: 1,
};

// ---------------------------------------------------------------------------
// Derivation from zod defs
// ---------------------------------------------------------------------------

function codecFor(schema: z.ZodType, path: string): Codec {
  const hit = explicit.get(schema) ?? derivedCache.get(schema);
  if (hit) return hit;
  const codec = derive(schema, path);
  derivedCache.set(schema, codec);
  return codec;
}

function optionsOf(schema: z.ZodType, path: string): readonly unknown[] {
  const entries = defOf(schema).entries as Record<string, unknown>;
  if (entries === undefined) {
    const opts = (schema as any).options;
    if (Array.isArray(opts)) return opts;
    throw schemaError(path, "enum has no introspectable members");
  }
  // A TypeScript numeric enum compiles to an object carrying reverse mappings
  // (Down: 2 AND "2": "Down"). Those reverse keys are not members: counting
  // them doubles the ordinal space, makes ordinals shift when a member is
  // merely appended, and lets a low ordinal decode to a member NAME instead of
  // its value.
  const reverseKeys = new Set(
    Object.values(entries)
      .filter((v) => typeof v === "number")
      .map(String),
  );
  return Object.entries(entries)
    .filter(([k]) => !reverseKeys.has(k))
    .map(([, v]) => v);
}

function derive(schema: z.ZodType, path: string): Codec {
  const d = defOf(schema);
  switch (d.type) {
    case "string":
      return strCodec;
    case "boolean":
      return boolByteCodec;
    case "bigint":
      return bigintCodec;
    case "literal": {
      const values = d.values as unknown[];
      return values.length === 1
        ? constCodec(values[0], path)
        : enumCodec(values, path);
    }
    case "enum":
      return enumCodec(optionsOf(schema, path), path);
    case "optional":
    case "nullable":
    case "default":
      return presenceCodec(schema, path);
    case "object":
      return objectCodec(d.shape, path);
    case "array":
      return arrayCodec(d.element, path);
    case "record":
      return recordCodec(d.keyType, d.valueType, path);
    case "union":
      return d.discriminator !== undefined
        ? taggedUnionCodec(d.discriminator, d.options, path)
        : untaggedUnionCodec(d.options, path, undefined);
    case "tuple":
      return tupleCodec(d.items, d.rest ?? null, path);
    case "lazy":
      return lazyCodec(d.getter, path);
    case "number":
      throw schemaError(
        path,
        "plain z.number() is ambiguous on the wire — use zb.uint(), zb.int(), or zb.float()",
      );
    case "intersection":
      throw schemaError(
        path,
        "z.intersection cannot be introspected — use zb.stamped()",
      );
    default:
      throw schemaError(
        path,
        `unsupported zod type "${d.type}" — use a zb builder or wrap the subtree with zb.json()`,
      );
  }
}

// Unwrap optional/nullable/default wrappers around a field or element.
interface Unwrapped {
  inner: z.ZodType;
  optionalLike: boolean; // may be absent (optional or default)
  nullable: boolean;
  defaultValue: (() => unknown) | undefined;
}

function unwrap(schema: z.ZodType): Unwrapped {
  let s = schema;
  let optionalLike = false;
  let nullable = false;
  let defaultValue: (() => unknown) | undefined;
  for (;;) {
    const d = defOf(s);
    if (d.type === "optional") {
      optionalLike = true;
      s = d.innerType;
    } else if (d.type === "nullable") {
      nullable = true;
      s = d.innerType;
    } else if (d.type === "default") {
      optionalLike = true;
      const dv = d.defaultValue;
      defaultValue = typeof dv === "function" ? dv : () => dv;
      s = d.innerType;
    } else {
      return { inner: s, optionalLike, nullable, defaultValue };
    }
  }
}

// Standalone wrapper (e.g. array element that is optional/nullable):
// one flag byte 0=absent, 1=null, 2=present.
//
// objectCodec implements the same absent/null/present decision with header
// BITS instead of a flag byte (a field costs no whole byte there). The two
// layouts are deliberately different but must stay semantically in lockstep —
// change one and check the other.
function presenceCodec(schema: z.ZodType, path: string): Codec {
  const { inner, optionalLike, nullable, defaultValue } = unwrap(schema);
  const innerCodec = codecFor(inner, path);
  return {
    enc: (w, v, ctx) => {
      if (v === undefined) {
        if (!optionalLike) throw new ZbEncodeError(`${path}: missing value`);
        w.u8(0);
      } else if (v === null) {
        if (!nullable) throw new ZbEncodeError(`${path}: unexpected null`);
        w.u8(1);
      } else {
        w.u8(2);
        innerCodec.enc(w, v, ctx);
      }
    },
    dec: (r, ctx) => {
      const flag = r.u8();
      switch (flag) {
        case 0:
          // Mirror the encoder: a required value must never come back absent,
          // or decodeBytesUnvalidated would hand out a schema-violating value.
          if (!optionalLike) {
            throw new ZbDecodeError(
              `${path}: absent flag for a required value`,
            );
          }
          return defaultValue !== undefined ? defaultValue() : undefined;
        case 1:
          if (!nullable) {
            throw new ZbDecodeError(
              `${path}: null flag for a non-nullable value`,
            );
          }
          return null;
        case 2:
          return innerCodec.dec(r, ctx);
        default:
          throw new ZbDecodeError(`${path}: invalid presence flag ${flag}`);
      }
    },
    minBytes: 1,
  };
}

interface FieldPlan {
  key: string;
  mode: "body" | "bool" | "const";
  codec: Codec | null;
  constValue: unknown;
  optionalLike: boolean;
  nullable: boolean;
  defaultValue: (() => unknown) | undefined;
  presenceBit: number; // -1 = always present
  nullBit: number; // -1 = never null
  valueBit: number; // bool value bit; -1 otherwise
}

// Wire layout: ceil(bits/8) header bytes, then field bodies in shape-
// declaration order. Bits are allocated per field, in declaration order, in
// the order (presence, null, bool-value), and packed LSB-first
// (byte = bit >> 3, mask = 1 << (bit & 7)). A field takes a presence bit only
// if optional/defaulted, a null bit only if nullable, and a value bit only if
// it is a boolean; booleans and single-value literals write no body bytes.
// Which bits a field owns is part of the wire format — see the header comment.
function objectCodec(shape: Record<string, any>, path: string): Codec {
  const plans: FieldPlan[] = [];
  let bits = 0;
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const { inner, optionalLike, nullable, defaultValue } = unwrap(
      fieldSchema as z.ZodType,
    );
    const innerDef = defOf(inner);
    let mode: FieldPlan["mode"] = "body";
    let constValue: unknown;
    let codec: Codec | null = null;
    // An explicitly registered codec (zb.custom / zb.json) always wins: the
    // bool/const packings below are inferred from the zod type alone and would
    // otherwise silently discard the codec the caller asked for.
    const registered = explicit.get(inner);
    if (registered !== undefined) {
      codec = registered;
    } else if (innerDef.type === "boolean") {
      mode = "bool";
    } else if (
      innerDef.type === "literal" &&
      (innerDef.values as unknown[]).length === 1
    ) {
      mode = "const";
      constValue = (innerDef.values as unknown[])[0];
    } else {
      codec = codecFor(inner, `${path}.${key}`);
    }
    plans.push({
      key,
      mode,
      codec,
      constValue,
      optionalLike,
      nullable,
      defaultValue,
      presenceBit: optionalLike ? bits++ : -1,
      nullBit: nullable ? bits++ : -1,
      valueBit: mode === "bool" ? bits++ : -1,
    });
  }
  const headerBytes = Math.ceil(bits / 8);
  // Headers up to 4 bytes fit in a JS int, which avoids allocating a subarray
  // view per decoded object. Wider headers keep the byte-array path.
  const narrowHeader = headerBytes <= 4;
  const count = plans.length;

  let minBytes = headerBytes;
  for (const p of plans) {
    if (p.mode === "body" && !p.optionalLike && p.codec !== null) {
      minBytes += p.codec.minBytes;
    }
  }

  return {
    enc: (w, v, ctx) => {
      const base = w.reserve(headerBytes);
      for (let i = 0; i < count; i++) {
        const p = plans[i];
        const value = (v as any)[p.key];
        if (value === undefined) {
          if (!p.optionalLike) {
            throw new ZbEncodeError(`${path}.${p.key}: missing required field`);
          }
          continue;
        }
        if (p.presenceBit >= 0) {
          w.orU8(base + (p.presenceBit >> 3), 1 << (p.presenceBit & 7));
        }
        if (value === null) {
          if (!p.nullable) {
            throw new ZbEncodeError(`${path}.${p.key}: unexpected null`);
          }
          w.orU8(base + (p.nullBit >> 3), 1 << (p.nullBit & 7));
          continue;
        }
        if (p.mode === "bool") {
          if (typeof value !== "boolean") {
            throw new ZbEncodeError(
              `${path}.${p.key}: expected a boolean, got ${typeof value}`,
            );
          }
          if (value) w.orU8(base + (p.valueBit >> 3), 1 << (p.valueBit & 7));
        } else if (p.mode === "const") {
          // Zero bytes on the wire, but a mismatch here is a caller bug the
          // decoder would silently paper over by substituting the literal.
          if (value !== p.constValue) {
            throw new ZbEncodeError(
              `${path}.${p.key}: expected literal ${String(p.constValue)}, got ${String(value)}`,
            );
          }
        } else {
          p.codec!.enc(w, value, ctx);
        }
      }
    },
    dec: (r, ctx) => {
      // Read the header as an integer when it fits in one, so the common case
      // neither allocates a subarray view nor a bit-testing closure. Both
      // branches inline the same bit test rather than sharing a helper.
      const out: any = {};
      if (narrowHeader) {
        let header = 0;
        for (let i = 0; i < headerBytes; i++) header |= r.u8() << (i * 8);
        for (let i = 0; i < count; i++) {
          const p = plans[i];
          if (p.presenceBit >= 0 && (header & (1 << p.presenceBit)) === 0) {
            if (p.defaultValue !== undefined) out[p.key] = p.defaultValue();
            continue;
          }
          if (p.nullBit >= 0 && (header & (1 << p.nullBit)) !== 0) {
            out[p.key] = null;
            continue;
          }
          if (p.mode === "bool") {
            out[p.key] = (header & (1 << p.valueBit)) !== 0;
          } else if (p.mode === "const") {
            out[p.key] = p.constValue;
          } else {
            out[p.key] = p.codec!.dec(r, ctx);
          }
        }
        return out;
      }
      const buf = r.readBytes(headerBytes);
      for (let i = 0; i < count; i++) {
        const p = plans[i];
        if (
          p.presenceBit >= 0 &&
          (buf[p.presenceBit >> 3] & (1 << (p.presenceBit & 7))) === 0
        ) {
          if (p.defaultValue !== undefined) out[p.key] = p.defaultValue();
          continue;
        }
        if (
          p.nullBit >= 0 &&
          (buf[p.nullBit >> 3] & (1 << (p.nullBit & 7))) !== 0
        ) {
          out[p.key] = null;
          continue;
        }
        if (p.mode === "bool") {
          out[p.key] = (buf[p.valueBit >> 3] & (1 << (p.valueBit & 7))) !== 0;
        } else if (p.mode === "const") {
          out[p.key] = p.constValue;
        } else {
          out[p.key] = p.codec!.dec(r, ctx);
        }
      }
      return out;
    },
    minBytes,
  };
}

function writeCount(w: ByteWriter, n: number, path: string): void {
  if (n > MAX_DECODE_ITEMS) {
    throw new ZbEncodeError(
      `${path}: ${n} elements exceeds the decode cap of ${MAX_DECODE_ITEMS}`,
    );
  }
  w.uint(n);
}

// A corrupt varint can claim up to 2^53 elements. Any element that costs at
// least one byte needs >= n bytes for n of them, so a claimed count above the
// input that actually remains cannot fit. Only whether minElemBytes is nonzero
// is used, NOT its exact value: an element's declared minimum can legitimately
// OVER-state its smallest real encoding (a nullable/optional field writes zero
// body bytes; a union's smallest variant may not be the one present), and
// multiplying by that inflated per-element minimum would false-reject a valid
// compact array as a malformed frame. Zero-width elements (literals,
// all-literal objects) advance the reader not at all, so those are caught by
// the reader's per-message element budget instead.
function readCount(r: ByteReader, path: string, minElemBytes: number): number {
  const n = r.uint();
  if (minElemBytes > 0 && n > r.remaining) {
    throw new ZbDecodeError(
      `${path}: ${n} elements exceeds the remaining ${r.remaining} byte(s)`,
    );
  }
  r.takeItems(n, path);
  return n;
}

function arrayCodec(element: z.ZodType, path: string): Codec {
  const elem = codecFor(element, `${path}[]`);
  return {
    enc: (w, v: unknown[], ctx) => {
      if (!Array.isArray(v)) {
        throw new ZbEncodeError(`${path}: expected an array`);
      }
      writeCount(w, v.length, path);
      for (const item of v) elem.enc(w, item, ctx);
    },
    dec: (r, ctx) => {
      const n = readCount(r, path, elem.minBytes);
      const out: unknown[] = [];
      // Deliberately not preallocated: n is attacker-influenced, and push
      // degrades gracefully when the input runs out first.
      for (let i = 0; i < n; i++) out.push(elem.dec(r, ctx));
      return out;
    },
    minBytes: 1,
  };
}

function recordCodec(
  keyType: z.ZodType,
  valueType: z.ZodType,
  path: string,
): Codec {
  const keyDef = defOf(keyType);
  if (keyDef.type !== "enum" && keyDef.type !== "string") {
    throw schemaError(
      `${path}{key}`,
      `unsupported record key type "${keyDef.type}" — keys must be strings or a z.enum`,
    );
  }
  const keyCodec: Codec =
    keyDef.type === "enum"
      ? enumCodec(optionsOf(keyType, `${path}{key}`), `${path}{key}`)
      : strCodec;
  const valCodec = codecFor(valueType, `${path}{}`);
  const pairMin = keyCodec.minBytes + valCodec.minBytes;
  return {
    enc: (w, v: Record<string, unknown>, ctx) => {
      const keys = Object.keys(v);
      writeCount(w, keys.length, path);
      for (const k of keys) {
        keyCodec.enc(w, k, ctx);
        valCodec.enc(w, v[k], ctx);
      }
    },
    dec: (r, ctx) => {
      const n = readCount(r, path, pairMin);
      const out: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) {
        const k = keyCodec.dec(r, ctx) as string;
        // Plain assignment of "__proto__" invokes the prototype setter, which
        // would swap the decoded object's prototype for attacker-chosen data
        // while leaving the key invisible to Object.keys.
        if (k === "__proto__") {
          throw new ZbDecodeError(`${path}: forbidden record key "__proto__"`);
        }
        if (Object.prototype.hasOwnProperty.call(out, k)) {
          throw new ZbDecodeError(`${path}: duplicate record key ${k}`);
        }
        out[k] = valCodec.dec(r, ctx);
      }
      return out;
    },
    minBytes: 1,
  };
}

interface TaggedVariant {
  index: number;
  codec: Codec;
}

function discriminatorValue(
  option: z.ZodType,
  key: string,
  path: string,
): unknown {
  const shape = defOf(option).shape;
  const disc = shape?.[key];
  if (disc === undefined) {
    throw schemaError(path, `variant lacks discriminator "${key}"`);
  }
  const dd = defOf(disc);
  if (dd.type !== "literal" || (dd.values as unknown[]).length !== 1) {
    throw schemaError(
      path,
      `discriminator "${key}" must be a single-value literal`,
    );
  }
  return (dd.values as unknown[])[0];
}

function taggedUnionParts(
  key: string,
  options: readonly z.ZodType[],
  path: string,
): { byValue: Map<unknown, TaggedVariant>; codecs: Codec[] } {
  const byValue = new Map<unknown, TaggedVariant>();
  const codecs: Codec[] = [];
  options.forEach((option, index) => {
    const value = discriminatorValue(option, key, `${path}#${index}`);
    const codec = codecFor(option, `${path}#${String(value)}`);
    byValue.set(value, { index, codec });
    codecs.push(codec);
  });
  return { byValue, codecs };
}

function minOf(codecs: readonly Codec[]): number {
  let m = Infinity;
  for (const c of codecs) m = Math.min(m, c.minBytes);
  return m === Infinity ? 0 : m;
}

function taggedUnionCodec(
  key: string,
  options: readonly z.ZodType[],
  path: string,
): Codec {
  const { byValue, codecs } = taggedUnionParts(key, options, path);
  return {
    enc: (w, v, ctx) => {
      const variant = byValue.get((v as any)?.[key]);
      if (variant === undefined) {
        throw new ZbEncodeError(
          `${path}: no variant for ${key}=${String((v as any)?.[key])}`,
        );
      }
      w.uint(variant.index);
      variant.codec.enc(w, v, ctx);
    },
    dec: (r, ctx) => {
      const idx = r.uint();
      if (idx >= codecs.length) {
        throw new ZbDecodeError(`${path}: union tag ${idx} out of range`);
      }
      return codecs[idx].dec(r, ctx);
    },
    minBytes: 1 + minOf(codecs),
  };
}

// Untagged unions get a synthetic varint tag. Without a `select`, the encoder
// picks the FIRST variant whose zod parse accepts the value — which costs a
// full safeParse per rejected candidate (~10us once zod builds a ZodError) and
// silently narrows the value when variants overlap, since zod objects strip
// unknown keys. Variants should be mutually exclusive; on a hot path pass
// `select` (or use a discriminated union) to skip the scan entirely.
function untaggedUnionCodec(
  options: readonly z.ZodType[],
  path: string,
  select: ((v: unknown) => number) | undefined,
): Codec {
  const codecs = options.map((o, i) => codecFor(o, `${path}|${i}`));
  return {
    enc: (w, v, ctx) => {
      if (select !== undefined) {
        const i = select(v);
        if (!Number.isInteger(i) || i < 0 || i >= codecs.length) {
          throw new ZbEncodeError(
            `${path}: select returned invalid index ${i}`,
          );
        }
        w.uint(i);
        codecs[i].enc(w, v, ctx);
        return;
      }
      for (let i = 0; i < options.length; i++) {
        if (options[i].safeParse(v).success) {
          w.uint(i);
          codecs[i].enc(w, v, ctx);
          return;
        }
      }
      throw new ZbEncodeError(`${path}: value matches no union variant`);
    },
    dec: (r, ctx) => {
      const idx = r.uint();
      if (idx >= codecs.length) {
        throw new ZbDecodeError(`${path}: union tag ${idx} out of range`);
      }
      return codecs[idx].dec(r, ctx);
    },
    minBytes: 1 + minOf(codecs),
  };
}

function tupleCodec(
  items: readonly z.ZodType[],
  rest: z.ZodType | null,
  path: string,
): Codec {
  const itemCodecs = items.map((s, i) => codecFor(s, `${path}[${i}]`));
  const restCodec = rest === null ? null : codecFor(rest, `${path}[...]`);
  const arity = items.length;
  let minBytes = 0;
  for (const c of itemCodecs) minBytes += c.minBytes;
  if (restCodec !== null) minBytes += 1;
  return {
    enc: (w, v: unknown[], ctx) => {
      if (!Array.isArray(v)) {
        throw new ZbEncodeError(`${path}: expected an array`);
      }
      // Without this, a short tuple reports a confusing leaf error and a long
      // one silently drops its extra elements.
      if (restCodec === null ? v.length !== arity : v.length < arity) {
        throw new ZbEncodeError(
          `${path}: expected ${restCodec === null ? "" : "at least "}${arity} tuple element(s), got ${v.length}`,
        );
      }
      for (let i = 0; i < arity; i++) itemCodecs[i].enc(w, v[i], ctx);
      if (restCodec !== null) {
        writeCount(w, v.length - arity, path);
        for (let i = arity; i < v.length; i++) restCodec.enc(w, v[i], ctx);
      }
    },
    dec: (r, ctx) => {
      const out: unknown[] = [];
      for (let i = 0; i < arity; i++) out.push(itemCodecs[i].dec(r, ctx));
      if (restCodec !== null) {
        const n = readCount(r, path, restCodec.minBytes);
        for (let i = 0; i < n; i++) out.push(restCodec.dec(r, ctx));
      }
      return out;
    },
    minBytes,
  };
}

function lazyCodec(getter: () => z.ZodType, path: string): Codec {
  let inner: Codec | null = null;
  const resolve = () => (inner ??= codecFor(getter(), `${path}<lazy>`));
  return {
    enc: (w, v, ctx) => resolve().enc(w, v, ctx),
    dec: (r, ctx) => {
      // Recursion is only reachable through z.lazy, so this is the one place
      // that needs a depth guard to keep deep input from overflowing the stack
      // with a RangeError instead of a ZbDecodeError.
      r.enterDepth(path);
      try {
        return resolve().dec(r, ctx);
      } finally {
        r.exitDepth();
      }
    },
    // A recursive schema's true minimum is not knowable here; 0 defers the
    // bound to the per-message element budget.
    minBytes: 0,
  };
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

export interface ZbMethods<S extends z.ZodType> {
  serialize(value: z.input<S>, ctx?: ZbContext): Uint8Array<ArrayBuffer>;
  // Decode + full zod validation. Use on anything from a peer.
  parseBytes(bytes: Uint8Array, ctx?: ZbContext): z.output<S>;
  // Decode only. The return type claims z.output<S> by assertion: no
  // refinement declared in a builder's options (min/max/regex) is enforced, so
  // a hostile payload can hand back an out-of-range number or an oversized
  // string. Only for data this process produced itself.
  decodeBytesUnvalidated(bytes: Uint8Array, ctx?: ZbContext): z.output<S>;
}

export type ZbSchema<S extends z.ZodType> = S & ZbMethods<S>;

// Pooled so the common case doesn't allocate a buffer, a DataView, and a
// growth chain per message. Guarded because a zb.custom codec could call
// serialize() re-entrantly, which would corrupt the shared cursor.
const sharedWriter = new ByteWriter(4096);
let writerInUse = false;

// Everything the codecs throw is either ZbDecodeError or (via schemaError, for
// a lazy subtree resolved at decode time) a plain Error. Anything else — a
// RangeError from an unexpected recursion, a TypeError from a hand-written
// zb.custom codec — would break the documented contract, so it is rewrapped.
function decodeContract<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ZbDecodeError) throw e;
    throw new ZbDecodeError(
      `decode failed: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
}

function attach<S extends z.ZodType>(schema: S, codec: Codec): ZbSchema<S> {
  // Register as well as attach, so the schema also works as a field/element
  // inside other zb schemas (e.g. StampedIntentSchema.array()).
  explicit.set(schema, codec);
  const methods: ZbMethods<S> = {
    serialize(value, ctx) {
      if (writerInUse) {
        const w = new ByteWriter();
        codec.enc(w, value, ctx);
        return w.finish();
      }
      writerInUse = true;
      try {
        sharedWriter.reset();
        codec.enc(sharedWriter, value, ctx);
        return sharedWriter.finish();
      } finally {
        writerInUse = false;
      }
    },
    decodeBytesUnvalidated(bytes, ctx) {
      return decodeContract(() => {
        const r = new ByteReader(bytes);
        const v = codec.dec(r, ctx);
        r.expectEnd();
        return v as z.output<S>;
      });
    },
    parseBytes(bytes, ctx) {
      const v = decodeContract(() => {
        const r = new ByteReader(bytes);
        const decoded = codec.dec(r, ctx);
        r.expectEnd();
        return decoded;
      });
      return schema.parse(v) as z.output<S>;
    },
  };
  return Object.assign(schema, methods);
}

interface NumberOpts {
  min?: number;
  max?: number;
}

interface StringOpts {
  min?: number;
  max?: number;
  regex?: RegExp;
}

function applyNumberOpts(s: z.ZodNumber, opts: NumberOpts): z.ZodNumber {
  if (opts.min !== undefined) s = s.min(opts.min);
  if (opts.max !== undefined) s = s.max(opts.max);
  return s;
}

function applyStringOpts(s: z.ZodString, opts: StringOpts): z.ZodString {
  if (opts.regex !== undefined) s = s.regex(opts.regex);
  if (opts.min !== undefined) s = s.min(opts.min);
  if (opts.max !== undefined) s = s.max(opts.max);
  return s;
}

// Non-negative integer, LEB128 varint on the wire.
export function uint(opts: NumberOpts = {}): z.ZodNumber {
  return register(
    applyNumberOpts(z.number().int().nonnegative(), opts),
    uintCodec,
  );
}

// Signed integer, zigzag varint on the wire.
export function int(opts: NumberOpts = {}): z.ZodNumber {
  return register(applyNumberOpts(z.number().int(), opts), intCodec);
}

// Any number, bit-exact float64 on the wire (8 bytes).
export function float(opts: NumberOpts = {}): z.ZodNumber {
  return register(applyNumberOpts(z.number(), opts), floatCodec);
}

function bigint_(): z.ZodBigInt {
  return register(z.bigint(), bigintCodec);
}

export function string(opts: StringOpts = {}): z.ZodString {
  return register(applyStringOpts(z.string(), opts), strCodec);
}

// Literals, enums, and booleans need no registration — they auto-derive —
// so these are plain aliases for symmetry.
const literal_ = z.literal;
export { literal_ as literal };
const enum_ = z.enum;
export { enum_ as enum };

// A string drawn from a ZbContext dictionary: one byte on the wire when the
// value is in the named table, escape byte + inline string otherwise.
export function mapped(name: string, opts: StringOpts = {}): z.ZodString {
  return register(applyStringOpts(z.string(), opts), mappedCodec(name));
}

// Escape hatch: encode a subtree as length-prefixed JSON. For cold, complex
// schemas that aren't worth a binary layout. Returns a CLONE so the annotation
// is local — registering against the caller's instance would change the wire
// format everywhere else that instance is referenced.
export function json<S extends z.ZodType>(schema: S): S {
  return register(schema.clone() as S, jsonCodec);
}

// Register a hand-written codec. Like zb.json, this returns a clone so the
// codec applies only where this result is used.
export function custom<S extends z.ZodType>(
  schema: S,
  codec: Omit<Codec<z.output<S>>, "minBytes"> & { minBytes?: number },
): S {
  return register(schema.clone() as S, {
    enc: codec.enc,
    dec: codec.dec,
    minBytes: codec.minBytes ?? 0,
  });
}

export function object<S extends z.ZodRawShape>(shape: S) {
  const s = z.object(shape);
  return attach(s, codecFor(s, "$"));
}

export function discriminatedUnion<
  const T extends readonly [
    z.core.$ZodTypeDiscriminable,
    ...z.core.$ZodTypeDiscriminable[],
  ],
>(discriminator: string, options: T) {
  const s = z.discriminatedUnion(discriminator, options);
  return attach(s, codecFor(s, "$"));
}

function union_<const T extends readonly [z.ZodType, ...z.ZodType[]]>(
  options: T,
  opts: { select?: (v: unknown) => number } = {},
) {
  const s = z.union(options);
  return attach(s, untaggedUnionCodec(options, "$", opts.select));
}
export { union_ as union };

// A discriminated union with extra sibling fields merged into every variant —
// the shape of zod's `union.and(z.object(extra))`, which cannot be derived
// generically. Wire layout: variant tag, extra fields, variant fields.
export function stamped<
  U extends z.ZodDiscriminatedUnion<readonly z.ZodObject[]>,
  E extends z.ZodRawShape,
>(unionSchema: U, extraShape: E) {
  const ud = defOf(unionSchema);
  if (ud.type !== "union" || ud.discriminator === undefined) {
    throw schemaError("$", "zb.stamped requires a discriminated union");
  }
  // A key in both places would be written twice and read back from the extras,
  // so reject it rather than silently paying for it.
  (ud.options as z.ZodType[]).forEach((option, i) => {
    for (const k of Object.keys(defOf(option).shape ?? {})) {
      if (Object.prototype.hasOwnProperty.call(extraShape, k)) {
        throw schemaError(
          `$#${i}`,
          `variant field "${k}" collides with a zb.stamped extra`,
        );
      }
    }
  });
  const { byValue, codecs } = taggedUnionParts(
    ud.discriminator,
    ud.options,
    "$",
  );
  const extraObject = z.object(extraShape);
  const extraCodec = codecFor(extraObject, "$&");
  const s = z.intersection(unionSchema, extraObject);
  const codec: Codec = {
    enc: (w, v, ctx) => {
      const discValue = (v as any)?.[ud.discriminator];
      const variant = byValue.get(discValue);
      if (variant === undefined) {
        throw new ZbEncodeError(
          `$: no variant for ${ud.discriminator}=${String(discValue)}`,
        );
      }
      w.uint(variant.index);
      extraCodec.enc(w, v, ctx);
      variant.codec.enc(w, v, ctx);
    },
    dec: (r, ctx) => {
      const idx = r.uint();
      if (idx >= codecs.length) {
        throw new ZbDecodeError(`$: union tag ${idx} out of range`);
      }
      const extras = extraCodec.dec(r, ctx) as object;
      const variant = codecs[idx].dec(r, ctx) as object;
      // Keys are disjoint (checked above), and `variant` is freshly built by
      // the variant codec, so assigning into it avoids a third object.
      return Object.assign(variant, extras);
    },
    minBytes: 1 + extraCodec.minBytes + minOf(codecs),
  };
  return attach(s, codec);
}

export function context(): ZbContext {
  return new ZbContext();
}

export type infer<S extends z.ZodType> = z.infer<S>;
export type input<S extends z.ZodType> = z.input<S>;
export type output<S extends z.ZodType> = z.output<S>;
