# zbin — compact binary serialization for zod schemas

Zod stays the single source of truth; zbin gives its schemas a compact binary
wire format. Every `zb.*` builder returns a **real zod schema** (`z.infer`,
`.optional()`, and plain-zod composition all keep working) with a binary codec
registered in a WeakMap side table keyed by schema **instance**. The root
builders — `zb.object`, `zb.discriminatedUnion`, `zb.union`, `zb.stamped` —
additionally attach `serialize` / `parseBytes` / `decodeBytesUnvalidated` to
that instance.

```ts
import { zb } from "./zbin";

const MsgSchema = zb.object({
  type: zb.literal("hash"), // 0 bytes on the wire
  hash: zb.float(), // float64, bit-exact
  turnNumber: zb.uint(), // LEB128 varint
});
type Msg = zb.infer<typeof MsgSchema>;

const msg: Msg = { type: "hash", hash: 0.5, turnNumber: 12 };
const ctx = zb.context();

const bytes = MsgSchema.serialize(msg, ctx); // Uint8Array
const back = MsgSchema.parseBytes(bytes, ctx); // decode + zod validation
```

## Compatibility: all peers must run the same build

**There is no version byte and no field tags on the wire.** A zbin payload is a
bare positional byte stream: the schema _is_ the format. Peers built from
different commits will mis-decode each other, and often **silently** —
reordering object fields, inserting an enum member, or reordering union
variants all produce structurally valid output that passes `parseBytes` with
the wrong values. Truncation is caught; semantic drift is not.

OpenFront ships the client and server together, so this is a deliberate
trade: no per-message version overhead, in exchange for requiring that
everything talking zbin comes from one build. If that ever stops being true,
a version must be added to the handshake before any zbin frame is sent.

These edits change the wire format and are only safe when every peer changes
with them:

- adding, removing, renaming, or reordering object fields
- making a field optional/nullable or undoing it (the presence-bit layout moves)
- switching a field to or from `boolean` (bool values live in the header)
- reordering `z.enum`, union variants, or `z.literal([...])` members
- changing tuple arity, or renaming a `zb.mapped` table
- changing the assign order of a mapping table

`tests/zbin/golden.test.ts` pins the layout as hex vectors, so an accidental
change fails a test instead of corrupting a game.

## What auto-derives

Plain zod schemas reachable from a zb root are handled without annotation:
strings, booleans, bigints, literals, enums, objects, arrays,
records/partialRecords, tuples (incl. `.rest`), discriminated and untagged
unions, `z.lazy`, and `optional`/`nullable`/`default` wrappers. Only genuinely
ambiguous or exotic spots need an explicit builder:

| Builder                     | Why                                                            | Wire encoding                               |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `zb.uint()` / `zb.int()`    | JSON can't say int vs float                                    | LEB128 / zigzag varint                      |
| `zb.float()`                | ″                                                              | float64 LE (bit-exact)                      |
| `zb.string(opts)`           | to attach `min`/`max`/`regex` safely                           | varint length + UTF-8                       |
| `zb.mapped(name)`           | dictionary compression                                         | 1-2 byte varint index, escape + inline else |
| `zb.json(schema)`           | cold, complex subtrees                                         | varint length + JSON                        |
| `zb.stamped(union, extras)` | intersections over a discriminated union can't be introspected | tag + extras + variant                      |
| `zb.custom(schema, codec)`  | full control                                                   | yours                                       |

`zb.bigint()`, `zb.literal`, and `zb.enum` are plain aliases kept for symmetry —
the underlying zod types auto-derive, so `z.bigint()` etc. work identically.

### Constraints go in the builder options

Chaining zod methods clones the schema, and the clone has no codec:

```ts
zb.uint({ max: 400 }); // correct
zb.uint().max(400); // throws: "plain z.number() is ambiguous on the wire"
zb.mapped("cid").min(1); // SILENT: falls back to plain strings, ~1 byte -> 9
zb.mapped("cid").describe("…"); // SILENT: same
```

Numeric builders fail loudly. String-shaped builders (`zb.string`, `zb.mapped`)
and `zb.json` / `zb.custom` fall back to the auto-derived codec instead, which
just changes the wire format — so put every constraint in the options.
`.optional()`, `.nullable()`, `.default(v)`, and `.array()` **are** safe to
chain.

Methods that clone (`.extend()`, `.pick()`, `.partial()`, `.optional()`) return
a plain zod schema **without** `serialize` / `parseBytes` /
`decodeBytesUnvalidated`. The clone still encodes correctly when nested inside
a zb root; to make it a root again, re-wrap it with `zb.object(Ext.shape)`.

`zb.json` and `zb.custom` return a **clone**, so the annotation is local to the
result — applying either to a shared subschema does not change how that
subschema encodes anywhere else.

## Encoding highlights

- Object fields are encoded in declaration order behind a leading presence-bit
  header: optional/nullable flags and boolean **values** are bits, so a
  message of eight booleans is one byte.
- Literal fields and discriminated-union tags cost 0 and ~1 byte respectively.
- Varints are minimal: a value has exactly one valid encoding, and non-minimal
  input is rejected.
- `z.record` encodes `Object.keys` order, so the same logical record built in
  two orders yields two different payloads. Sort before hashing or comparing.
- Untagged `zb.union` picks the first variant whose zod parse accepts the
  value. That costs a full `safeParse` per rejected candidate (~10 µs once zod
  builds a `ZodError`) and silently narrows the value when variants overlap,
  since zod objects strip unknown keys. Keep variants mutually exclusive, and
  on a hot path pass `select` or use a discriminated union:
  ```ts
  zb.union([A, B], { select: (v) => ("a" in v ? 0 : 1) });
  ```
- `zb.json` subtrees are JSON, not binary, so they are exempt from the
  bit-exactness above: `NaN`/`Infinity` become `null`, `-0` becomes `0`, `Date`
  becomes a string, and `undefined` keys vanish. `bigint` throws.

## Errors

| Method                   | Validates? | Throws                      |
| ------------------------ | ---------- | --------------------------- |
| `serialize`              | no         | `ZbEncodeError`             |
| `parseBytes`             | yes        | `ZbDecodeError`, `ZodError` |
| `decodeBytesUnvalidated` | no         | `ZbDecodeError`             |

`parseBytes` decodes and then runs `schema.parse`. **Use it for anything
arriving from a peer.**

`decodeBytesUnvalidated` returns `z.output<S>` by assertion only: nothing is
checked, so `min`/`max`/`regex`/`.refine()` are all skipped and a hostile
payload can hand back a 1 MB string where the schema says `max: 4`, or `NaN`
from a `zb.float()`. Note that OpenFront's server is an intent _relay_ — a
client receiving a turn is receiving content authored by other clients — so
"the socket is trusted" is not the same as "the values are trusted". Reach for
this only on data this process produced itself.

All structural corruption surfaces as `ZbDecodeError`, never a raw
`RangeError`/`SyntaxError`: truncation, trailing bytes, bad enum/union
ordinals, invalid presence flags, unknown dictionary indexes, non-minimal
varints, invalid UTF-8, corrupt embedded JSON, over-budget collection counts,
and nesting past the depth limit.

## Limits

| Limit                        | Value                         |
| ---------------------------- | ----------------------------- |
| `zb.uint` range              | `[0, 2^53)`                   |
| `zb.int` range               | `±2^52`                       |
| `zb.bigint` width            | 1024 bits (`MAX_BIGINT_BITS`) |
| Decoded elements per message | 2^20 (`MAX_DECODE_ITEMS`)     |
| Nesting depth                | 64 (`MAX_DECODE_DEPTH`)       |
| Mapping table entries        | 65,535 (`MAX_MAPPING_SIZE`)   |

The element budget is per message and shared across every collection in it.
It exists because elements can encode to zero bytes (single-value literals,
all-literal objects), which makes "count vs. remaining input" an insufficient
bound on its own — without it, four bytes could drive 16M allocations.

## Contexts (dictionary compression)

```ts
const ctx = zb.context();
ctx.mapping("clientId");
ctx.assign("clientId", "aB3dEf7h"); // → index 0
ctx.assignAll("clientId", roster); // or seed in bulk
```

A `zb.mapped("clientId")` field encodes as `varint(index + 1)` when the value
is in the table — one byte for the first 127 entries, two up to 16k — or as
varint 0 plus the inline string when it isn't. There is no
on-wire learning: both peers must build identical tables from shared data
(assign order is part of the wire contract). This keeps decoding stateless per
message — no stream-position coupling, nothing to break on reconnect.

**Tables are seeded from runtime data, so a shared build does not make them
agree.** An index past the end of the receiver's table is a loud
`ZbDecodeError`, but two tables of equal length in a different order decode
every id to the _wrong value_ with no error — for `clientId` that means
attributing intents to the wrong player. Compare `ctx.fingerprint(name)`
out-of-band (e.g. in the game-start handshake) before relying on a table:

```ts
if (local.fingerprint("clientId") !== remote.clientIdFingerprint) {
  throw new Error("roster mismatch");
}
```

Encoding against a context that has not declared the table is a
`ZbEncodeError`, so a typo'd name fails instead of silently costing the
compression. Encoding with no context at all stays legal — everything goes
inline.

## Boundaries

This directory is a self-contained library: zod is its only dependency and it
must not import anything from the game. (It is a candidate for extraction into
a standalone package once it has production mileage.) It is compiled as part of
the root `tsconfig.json` and copied into both Docker stages alongside `src/`.
