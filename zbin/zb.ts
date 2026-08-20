// zbin — compact binary serialization for zod schemas.
//
// Every builder here returns a REAL zod schema (usable with z.infer,
// .optional(), .extend(), plain-zod composition, JSON paths) whose binary
// codec is registered in a WeakMap side table. Root builders (object,
// discriminatedUnion, union, stamped) additionally attach
// serialize/parseBytes/decodeBytes methods.
//
// Most plain zod schemas are auto-derived when reachable from a zb root:
// strings, booleans, literals, enums, objects, arrays, records, tuples,
// (discriminated) unions, lazy, and optional/nullable/default wrappers.
// Only genuinely ambiguous or exotic spots need an explicit builder:
//   - numbers: JSON can't say int vs float, so use zb.uint/int/float
//   - dictionary-compressed ids: zb.mapped
//   - complex cold subtrees: zb.json (length-prefixed JSON escape hatch)
//   - intersections over a discriminated union: zb.stamped
//
// Wire-format invariants (a breaking change to any of these needs a protocol
// version bump by the application):
//   - object field order = shape declaration order
//   - enum/union ordinals = declaration order
//   - optional/nullable/boolean fields live in a leading presence-bit header

import { z } from "zod";
import { ByteReader, ByteWriter, ZbDecodeError, ZbEncodeError } from "./bytes";
import { ESCAPE_BYTE, ZbContext } from "./context";

export { ByteReader, ByteWriter, ZbDecodeError, ZbEncodeError } from "./bytes";
export { ZbContext } from "./context";
export { bigint_ as bigint };

export interface Codec<T = any> {
  enc(w: ByteWriter, v: T, ctx: ZbContext | undefined): void;
  dec(r: ByteReader, ctx: ZbContext | undefined): T;
}

const registry = new WeakMap<z.ZodType, Codec>();

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
};

const intCodec: Codec<number> = {
  enc: (w, v) => w.int(v),
  dec: (r) => r.int(),
};

const floatCodec: Codec<number> = {
  enc: (w, v) => w.f64(v),
  dec: (r) => r.f64(),
};

const bigintCodec: Codec<bigint> = {
  enc: (w, v) => w.bigint(v),
  dec: (r) => r.bigint(),
};

const strCodec: Codec<string> = {
  enc: (w, v) => w.str(v),
  dec: (r) => r.str(),
};

// Standalone boolean (inside arrays etc.). Object fields pack booleans into
// the presence-bit header instead.
const boolByteCodec: Codec<boolean> = {
  enc: (w, v) => w.u8(v ? 1 : 0),
  dec: (r) => {
    const b = r.u8();
    if (b > 1) throw new ZbDecodeError(`invalid boolean byte ${b}`);
    return b === 1;
  },
};

function constCodec(value: unknown): Codec {
  return { enc: () => {}, dec: () => value };
}

function enumCodec(values: readonly unknown[], path: string): Codec {
  const toIndex = new Map<unknown, number>();
  values.forEach((v, i) => toIndex.set(v, i));
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
  };
}

function mappedCodec(name: string): Codec<string> {
  return {
    enc: (w, v, ctx) => {
      const idx = ctx?.indexOf(name, v);
      if (idx !== undefined && idx < ESCAPE_BYTE) {
        w.u8(idx);
      } else {
        w.u8(ESCAPE_BYTE);
        w.str(v);
      }
    },
    dec: (r, ctx) => {
      const b = r.u8();
      if (b === ESCAPE_BYTE) return r.str();
      const value = ctx?.valueAt(name, b);
      if (value === undefined) {
        throw new ZbDecodeError(`unknown "${name}" dictionary index ${b}`);
      }
      return value;
    },
  };
}

const jsonCodec: Codec = {
  enc: (w, v) => w.str(JSON.stringify(v)),
  dec: (r) => {
    const s = r.str();
    try {
      return JSON.parse(s);
    } catch {
      // Uniform decode-error contract: corrupt input always surfaces as
      // ZbDecodeError, never a raw SyntaxError.
      throw new ZbDecodeError("invalid embedded JSON");
    }
  },
};

// ---------------------------------------------------------------------------
// Derivation from zod defs
// ---------------------------------------------------------------------------

function codecFor(schema: z.ZodType, path: string): Codec {
  const hit = registry.get(schema);
  if (hit) return hit;
  const codec = derive(schema, path);
  registry.set(schema, codec);
  return codec;
}

function optionsOf(schema: z.ZodType): readonly unknown[] {
  const opts = (schema as any).options;
  if (Array.isArray(opts)) return opts;
  return Object.values(defOf(schema).entries);
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
        ? constCodec(values[0])
        : enumCodec(values, path);
    }
    case "enum":
      return enumCodec(optionsOf(schema), path);
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
        : untaggedUnionCodec(d.options, path);
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
          return defaultValue !== undefined ? defaultValue() : undefined;
        case 1:
          return null;
        case 2:
          return innerCodec.dec(r, ctx);
        default:
          throw new ZbDecodeError(`${path}: invalid presence flag ${flag}`);
      }
    },
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
    if (innerDef.type === "boolean") {
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

  return {
    enc: (w, v, ctx) => {
      const base = w.reserve(headerBytes);
      const setBit = (bit: number) => w.orU8(base + (bit >> 3), 1 << (bit & 7));
      for (const p of plans) {
        const value = (v as any)[p.key];
        if (value === undefined) {
          if (!p.optionalLike) {
            throw new ZbEncodeError(`${path}.${p.key}: missing required field`);
          }
          continue;
        }
        if (p.presenceBit >= 0) setBit(p.presenceBit);
        if (value === null) {
          if (!p.nullable) {
            throw new ZbEncodeError(`${path}.${p.key}: unexpected null`);
          }
          setBit(p.nullBit);
          continue;
        }
        if (p.mode === "bool") {
          if (value) setBit(p.valueBit);
        } else if (p.mode === "body") {
          p.codec!.enc(w, value, ctx);
        }
        // "const" fields cost zero bytes.
      }
    },
    dec: (r, ctx) => {
      const header = r.readBytes(headerBytes);
      const bit = (i: number) => (header[i >> 3] & (1 << (i & 7))) !== 0;

      const out: any = {};
      for (const p of plans) {
        if (p.presenceBit >= 0 && !bit(p.presenceBit)) {
          if (p.defaultValue !== undefined) out[p.key] = p.defaultValue();
          continue;
        }
        if (p.nullBit >= 0 && bit(p.nullBit)) {
          out[p.key] = null;
          continue;
        }
        if (p.mode === "bool") {
          out[p.key] = bit(p.valueBit);
        } else if (p.mode === "const") {
          out[p.key] = p.constValue;
        } else {
          out[p.key] = p.codec!.dec(r, ctx);
        }
      }
      return out;
    },
  };
}

// Sanity cap on decoded collection counts. A corrupt varint can claim up to
// 2^53 elements; without a cap that means a pathological allocation or a
// decode loop that never touches the (long-exhausted) input. Far above any
// real payload, low enough to fail fast.
const MAX_DECODE_ITEMS = 1 << 24;

function readCount(r: ByteReader, path: string): number {
  const n = r.uint();
  if (n > MAX_DECODE_ITEMS) {
    throw new ZbDecodeError(
      `${path}: collection count ${n} exceeds sanity cap`,
    );
  }
  return n;
}

function arrayCodec(element: z.ZodType, path: string): Codec {
  const elem = codecFor(element, `${path}[]`);
  return {
    enc: (w, v: unknown[], ctx) => {
      w.uint(v.length);
      for (const item of v) elem.enc(w, item, ctx);
    },
    dec: (r, ctx) => {
      const n = readCount(r, path);
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(elem.dec(r, ctx));
      return out;
    },
  };
}

function recordCodec(
  keyType: z.ZodType,
  valueType: z.ZodType,
  path: string,
): Codec {
  const keyDef = defOf(keyType);
  const keyCodec: Codec =
    keyDef.type === "enum"
      ? enumCodec(optionsOf(keyType), `${path}{key}`)
      : strCodec;
  const valCodec = codecFor(valueType, `${path}{}`);
  return {
    enc: (w, v: Record<string, unknown>, ctx) => {
      const keys = Object.keys(v);
      w.uint(keys.length);
      for (const k of keys) {
        keyCodec.enc(w, k, ctx);
        valCodec.enc(w, v[k], ctx);
      }
    },
    dec: (r, ctx) => {
      const n = readCount(r, path);
      const out: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) {
        const k = keyCodec.dec(r, ctx) as string;
        out[k] = valCodec.dec(r, ctx);
      }
      return out;
    },
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

function taggedUnionCodec(
  key: string,
  options: readonly z.ZodType[],
  path: string,
): Codec {
  const { byValue, codecs } = taggedUnionParts(key, options, path);
  return {
    enc: (w, v, ctx) => {
      const variant = byValue.get((v as any)[key]);
      if (variant === undefined) {
        throw new ZbEncodeError(
          `${path}: no variant for ${key}=${String((v as any)[key])}`,
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
  };
}

// Untagged unions get a synthetic varint tag; the encoder picks the first
// variant whose zod parse accepts the value. Fine for rare fields — avoid on
// hot paths.
function untaggedUnionCodec(
  options: readonly z.ZodType[],
  path: string,
): Codec {
  const codecs = options.map((o, i) => codecFor(o, `${path}|${i}`));
  return {
    enc: (w, v, ctx) => {
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
  };
}

function tupleCodec(
  items: readonly z.ZodType[],
  rest: z.ZodType | null,
  path: string,
): Codec {
  const itemCodecs = items.map((s, i) => codecFor(s, `${path}[${i}]`));
  const restCodec = rest === null ? null : codecFor(rest, `${path}[...]`);
  return {
    enc: (w, v: unknown[], ctx) => {
      itemCodecs.forEach((c, i) => c.enc(w, v[i], ctx));
      if (restCodec !== null) {
        w.uint(v.length - items.length);
        for (let i = items.length; i < v.length; i++) {
          restCodec.enc(w, v[i], ctx);
        }
      }
    },
    dec: (r, ctx) => {
      const out: unknown[] = itemCodecs.map((c) => c.dec(r, ctx));
      if (restCodec !== null) {
        const n = readCount(r, path);
        for (let i = 0; i < n; i++) out.push(restCodec.dec(r, ctx));
      }
      return out;
    },
  };
}

function lazyCodec(getter: () => z.ZodType, path: string): Codec {
  let inner: Codec | null = null;
  const resolve = () => (inner ??= codecFor(getter(), `${path}<lazy>`));
  return {
    enc: (w, v, ctx) => resolve().enc(w, v, ctx),
    dec: (r, ctx) => resolve().dec(r, ctx),
  };
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

export interface ZbMethods<S extends z.ZodType> {
  serialize(value: z.input<S>, ctx?: ZbContext): Uint8Array<ArrayBuffer>;
  // Decode + full zod validation. Use on untrusted input.
  parseBytes(bytes: Uint8Array, ctx?: ZbContext): z.output<S>;
  // Decode only. Use where the peer is trusted and throughput matters.
  decodeBytes(bytes: Uint8Array, ctx?: ZbContext): z.output<S>;
}

export type ZbSchema<S extends z.ZodType> = S & ZbMethods<S>;

function attach<S extends z.ZodType>(schema: S, codec: Codec): ZbSchema<S> {
  // Register as well as attach, so the schema also works as a field/element
  // inside other zb schemas (e.g. StampedIntentSchema.array()).
  registry.set(schema, codec);
  const methods: ZbMethods<S> = {
    serialize(value, ctx) {
      const w = new ByteWriter();
      codec.enc(w, value, ctx);
      return w.finish();
    },
    decodeBytes(bytes, ctx) {
      const r = new ByteReader(bytes);
      const v = codec.dec(r, ctx);
      r.expectEnd();
      return v as z.output<S>;
    },
    parseBytes(bytes, ctx) {
      const r = new ByteReader(bytes);
      const v = codec.dec(r, ctx);
      r.expectEnd();
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

// Non-negative integer, LEB128 varint on the wire.
export function uint(opts: NumberOpts = {}): z.ZodNumber {
  const s = applyNumberOpts(z.number().int().nonnegative(), opts);
  registry.set(s, uintCodec);
  return s;
}

// Signed integer, zigzag varint on the wire.
export function int(opts: NumberOpts = {}): z.ZodNumber {
  const s = applyNumberOpts(z.number().int(), opts);
  registry.set(s, intCodec);
  return s;
}

// Any number, bit-exact float64 on the wire (8 bytes).
export function float(opts: NumberOpts = {}): z.ZodNumber {
  const s = applyNumberOpts(z.number(), opts);
  registry.set(s, floatCodec);
  return s;
}

export function bool(): z.ZodBoolean {
  const s = z.boolean();
  registry.set(s, boolByteCodec);
  return s;
}

function bigint_(): z.ZodBigInt {
  const s = z.bigint();
  registry.set(s, bigintCodec);
  return s;
}

export function string(opts: StringOpts = {}): z.ZodString {
  let s = z.string();
  if (opts.regex !== undefined) s = s.regex(opts.regex);
  if (opts.min !== undefined) s = s.min(opts.min);
  if (opts.max !== undefined) s = s.max(opts.max);
  registry.set(s, strCodec);
  return s;
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
  let s = z.string();
  if (opts.regex !== undefined) s = s.regex(opts.regex);
  if (opts.min !== undefined) s = s.min(opts.min);
  if (opts.max !== undefined) s = s.max(opts.max);
  registry.set(s, mappedCodec(name));
  return s;
}

// Escape hatch: encode a subtree as length-prefixed JSON. For cold, complex
// schemas that aren't worth a binary layout.
export function json<S extends z.ZodType>(schema: S): S {
  registry.set(schema, jsonCodec);
  return schema;
}

// Register a hand-written codec for an arbitrary schema.
export function custom<S extends z.ZodType>(
  schema: S,
  codec: Codec<z.output<S>>,
): S {
  registry.set(schema, codec);
  return schema;
}

export function object<S extends z.ZodRawShape>(shape: S) {
  const s = z.object(shape);
  return attach(s, codecFor(s, "$"));
}

export function discriminatedUnion<
  const T extends readonly [z.ZodObject, ...z.ZodObject[]],
>(discriminator: string, options: T) {
  const s = z.discriminatedUnion(discriminator, options as any);
  return attach(s, codecFor(s, "$"));
}

function union_<const T extends readonly [z.ZodType, ...z.ZodType[]]>(
  options: T,
) {
  const s = z.union(options);
  return attach(s, codecFor(s, "$"));
}
export { union_ as union };

// A discriminated union with extra sibling fields merged into every variant —
// the shape of zod's `union.and(z.object(extra))`, which cannot be derived
// generically. Wire layout: variant tag, extra fields, variant fields.
export function stamped<U extends z.ZodType, E extends z.ZodRawShape>(
  unionSchema: U,
  extraShape: E,
) {
  const ud = defOf(unionSchema);
  if (ud.type !== "union" || ud.discriminator === undefined) {
    throw schemaError("$", "zb.stamped requires a discriminated union");
  }
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
      const discValue = (v as any)[ud.discriminator];
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
      return { ...variant, ...extras };
    },
  };
  return attach(s, codec);
}

export function context(): ZbContext {
  return new ZbContext();
}

export type infer<S extends z.ZodType> = z.infer<S>;
export type input<S extends z.ZodType> = z.input<S>;
export type output<S extends z.ZodType> = z.output<S>;
