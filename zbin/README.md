# zbin — compact binary serialization for zod schemas

Zod stays the single source of truth; zbin gives its schemas a compact binary
wire format. Every `zb.*` builder returns a **real zod schema** (`z.infer`,
`.optional()`, `.extend()`, and plain-zod composition all keep working) with a
binary codec registered in a WeakMap side table. Root builders additionally
attach `serialize` / `parseBytes` / `decodeBytes`.

```ts
import { zb } from "./zbin";

const MsgSchema = zb.object({
  type: zb.literal("hash"), // 0 bytes on the wire
  hash: zb.float(), // float64, bit-exact
  turnNumber: zb.uint(), // LEB128 varint
});
type Msg = zb.infer<typeof MsgSchema>;

const bytes = MsgSchema.serialize(msg, ctx); // Uint8Array
const back = MsgSchema.parseBytes(bytes, ctx); // decode + zod validation
```

## What auto-derives

Plain zod schemas reachable from a zb root are handled without annotation:
strings, booleans, literals, enums, objects, arrays, records/partialRecords,
tuples (incl. `.rest`), discriminated and untagged unions, `z.lazy`, and
`optional`/`nullable`/`default` wrappers. Only genuinely ambiguous or exotic
spots need an explicit builder:

| Builder                     | Why                                                            | Wire encoding                            |
| --------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| `zb.uint()` / `zb.int()`    | JSON can't say int vs float                                    | LEB128 / zigzag varint                   |
| `zb.float()`                | ″                                                              | float64 LE (bit-exact)                   |
| `zb.bigint()`               | not JSON-native                                                | zigzag varint                            |
| `zb.mapped(name)`           | dictionary compression                                         | 1 byte via context, escape + inline else |
| `zb.json(schema)`           | cold, complex subtrees                                         | varint length + JSON                     |
| `zb.stamped(union, extras)` | intersections over a discriminated union can't be introspected | tag + extras + variant                   |
| `zb.custom(schema, codec)`  | full control                                                   | yours                                    |

Validation constraints go in the builder options (`zb.uint({ max: 400 })`,
`zb.string({ regex: ... })`), not chained afterwards — zod's `.min()` etc.
return fresh instances that would lose the codec registration. `.optional()`,
`.nullable()`, and `.default(v)` **are** chainable.

## Encoding highlights

- Object fields are encoded in declaration order behind a leading presence-bit
  header: optional/nullable flags and boolean **values** are bits, so a
  message of eight booleans is one byte.
- Literal fields and discriminated-union tags cost 0 and ~1 byte respectively.
- `parseBytes` = decode + full `schema.parse` (use on untrusted input);
  `decodeBytes` skips validation for trusted hot paths. Trailing bytes,
  truncation, bad ordinals, and unknown dictionary indexes all throw
  `ZbDecodeError`.

## Contexts (dictionary compression)

```ts
const ctx = zb.context();
ctx.mapping("clientId", { max: 125 });
ctx.assign("clientId", "aB3dEf7h"); // → index 0
```

A `zb.mapped("clientId")` field encodes as one byte when the value is in the
table, or an escape byte plus the inline string when it isn't. There is no
on-wire learning: both peers must build identical tables from shared data
(assign order is part of the wire contract). This keeps decoding stateless per
message — no stream-position coupling, nothing to break on reconnect.

## Wire-format invariants

Changing any of these is a breaking protocol change (bump your app's version
byte): object field order, enum/union declaration order, presence-bit layout,
and the contents of any mapping table's assign order.

## Boundaries

This directory is a self-contained library: zod is its only dependency and it
must not import anything from the game. (It is a candidate for extraction into
a standalone package once it has production mileage.)
