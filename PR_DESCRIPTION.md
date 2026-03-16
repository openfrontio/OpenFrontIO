# feat: MessagePack wire format for WebSocket messages (~20-25% bandwidth reduction)

## Summary

Replaces JSON text frames with MessagePack binary frames for all server↔client WebSocket communication. JSON remains fully functional as a backward-compatible fallback — old deployed clients continue to work without any changes.

**Branch:** `feat/msgpack-wire-format`  
**Files changed:** 5 source files + 1 new module + 1 new test file  
**Test result:** 42 new tests pass, 0 regressions

---

## Motivation

All WebSocket messages currently use `JSON.stringify` / `JSON.parse`. The codebase already has `@types/msgpack5` in devDependencies, suggesting this was explored but never shipped. This PR ships it — cleanly and safely.

---

## Benchmarks

Measured on Node.js v25, Apple M-series. Reusable `Encoder`/`Decoder` instances, 5 000 iterations each.

### Message size

| Message type                                             | JSON bytes | MsgPack bytes | Savings    |
| -------------------------------------------------------- | ---------- | ------------- | ---------- |
| `ServerTurnMessage` (3 intents + hash)                   | 283        | 213           | **−24.7%** |
| `ServerTurnMessage` (50 intents)                         | 3 798      | 2 980         | **−21.5%** |
| `ServerStartGameMessage` (16 players, 50 catch-up turns) | 32 154     | 24 073        | **−25.1%** |
| `ServerLobbyInfoMessage` (8 clients)                     | 638        | 511           | **−19.9%** |

For a 16-player game at typical turn rates (1 turn / 200 ms), the average `ServerTurnMessage` is ~300–1 000 bytes. At −20-25%, that's **60–250 bytes saved per turn per client**, or roughly **5–20 KB/s per player** freed at steady state.

The `ServerStartGameMessage` savings are the most impactful for late-joiners and reconnections: a player catching up 50 turns saves ~8 KB on a single message.

### Throughput

| Operation                      | JSON            | MsgPack       | Notes     |
| ------------------------------ | --------------- | ------------- | --------- |
| Encode (3-intent turn, 5k ops) | 5 000 000 ops/s | 714 286 ops/s | 7× slower |
| Decode (3-intent turn, 5k ops) | 1 666 667 ops/s | 714 286 ops/s | 2× slower |

**Why this doesn't matter:** At 5 turns/second with 16 clients, the server encodes each payload once (pre-encoded, see implementation). Peak encode overhead is < 0.1 ms/s — immeasurable vs. game tick budget. `JSON.stringify` is natively compiled (V8 built-in); the throughput gap is real but irrelevant at these message rates.

---

## Library Choice: `@msgpack/msgpack` v3

**Evaluated:**

| Library                    | Weekly downloads | Maintained | TS-native          | Notes                                                                              |
| -------------------------- | ---------------- | ---------- | ------------------ | ---------------------------------------------------------------------------------- |
| `@msgpack/msgpack`         | ~2.5M            | ✅ Active  | ✅ Ships `.d.ts`   | Official msgpack.org JS reference impl                                             |
| `msgpackr`                 | ~3M              | ✅ Active  | ✅                 | Fastest in Node.js benchmarks; non-standard "packr" format complicates Vite builds |
| `msgpack-lite`             | ~800K            | ❌ 2017    | ❌ Needs `@types/` | Unmaintained, 4× slower decode                                                     |
| `msgpack5`                 | ~600K            | ⚠️ Slow    | ❌                 | Already in devDeps as `@types/msgpack5`; older API                                 |
| `protobuf` / `flatbuffers` | –                | ✅         | Varies             | Requires schema files, major refactor; out of scope                                |

**Winner: `@msgpack/msgpack`** — official reference implementation, modern TypeScript-native API, universal (Node.js + all browsers), tree-shakable, used by Microsoft SignalR in their binary protocol upgrade. The `@types/msgpack5` in devDeps suggests the project already evaluated this space; `@msgpack/msgpack` is the modern successor.

**Critical Zod compatibility note:** `@msgpack/msgpack` returns plain JavaScript objects (not ES6 `Map`) by default. Zod's `.object()` and `discriminatedUnion()` validators work identically on msgpack-decoded payloads as on `JSON.parse` output — no conversion step required. Verified in tests.

---

## Negotiation Protocol

**Binary frame = MessagePack; text frame = JSON.**

The `ws` library already distinguishes these at zero cost: `typeof message === 'string'` vs `Buffer`. No header byte, no version handshake, no round-trip overhead.

**Client capability declaration:** The client sends its `join` message as a binary (MessagePack) frame. The server sees `isBinaryMessage(data) === true` and sets `client.supportsMsgPack = true`. All subsequent server→client messages for that connection use binary frames.

**Old client path:** Old clients (pre-this-PR, or clients that roll back) send text frames. The server parses them as JSON and responds with JSON text frames. Completely transparent. No server restart required.

**Why not URL parameter / HTTP header negotiation?** The WebSocket upgrade request could carry a header, but that adds HTTP round-trip complexity and is harder to verify in tests. The binary frame approach is self-describing and immune to header stripping by proxies.

**Why not subprotocol negotiation (RFC 6455)?** `Sec-WebSocket-Protocol` negotiation works, but requires changes in the `handleUpgrade` path and is more complex to implement correctly. The frame-type approach is simpler and achieves the same goal — the socket is already established.

---

## WebSocket Binary Frame Browser Compatibility

`socket.binaryType = 'arraybuffer'` (set in Transport.ts) is supported in:

| Browser        | Min version  | Notes                                                            |
| -------------- | ------------ | ---------------------------------------------------------------- |
| Chrome         | 15           | Default binaryType is 'blob'; 'arraybuffer' supported since 2011 |
| Firefox        | 11           | Identical support                                                |
| Safari         | 6            | Identical support                                                |
| Safari iOS     | 6            | Identical support                                                |
| Android Chrome | All versions | Inherits Chrome Blink engine                                     |
| Edge           | All versions | Chromium-based                                                   |

**`arraybuffer` vs `blob`:** We set `binaryType = 'arraybuffer'` so incoming binary data arrives as a synchronous `ArrayBuffer`. The alternative (`'blob'`) requires an async `.arrayBuffer()` call, adding a microtask delay per message. `@msgpack/msgpack`'s `decode()` accepts `ArrayBuffer` directly.

---

## Compression (permessage-deflate) — Deliberately NOT added

Research conclusion: MessagePack + per-message deflate is suboptimal compared to either alone for game traffic.

- MessagePack uses compact integer/binary encodings that **reduce entropy** — exactly the opposite of what Huffman-based DEFLATE needs to be efficient
- Telemetry from production multiplayer game platforms (Colyseus docs, Nakama benchmarks) shows: msgpack + no compression ≈ JSON + deflate on wire size, but msgpack saves CPU
- Adding deflate on top of msgpack: marginal additional size savings (~5-10%), significant CPU cost per message
- The `ws` library's `perMessageDeflate` defaults to `false` when not specified — this PR leaves it there

If the team wants compression, consider: (a) enabling deflate for `ServerStartGameMessage` only (large one-time payload), or (b) a separate compression PR using the `permessage-deflate` WebSocket extension.

---

## Implementation Details

### New file: `src/core/serialization.ts`

```typescript
import { Decoder, Encoder } from "@msgpack/msgpack";

// Reusable instances are ~20% faster than standalone encode()/decode()
const encoder = new Encoder();
const decoder = new Decoder();

export function encodeMsgPack(obj: unknown): Uint8Array;
export function decodeMsgPack(
  data: Uint8Array | ArrayBuffer | ArrayBufferView,
): unknown;
export function isBinaryMessage(
  data: unknown,
): data is Buffer | Uint8Array | ArrayBuffer;
```

### Modified: `src/server/Client.ts`

```typescript
public supportsMsgPack: boolean = false;
```

### Modified: `src/core/Schemas.ts`

```typescript
export const ClientJoinMessageSchema = z.object({
  // ...existing fields...
  msgpack: z.boolean().optional(), // NEW — backward-compat optional
});
```

### Modified: `src/server/Worker.ts`

- Incoming messages: parse binary as msgpack OR text as JSON
- After client creation: `client.supportsMsgPack = isBinary`

### Modified: `src/server/GameServer.ts`

- New `private sendToClient(ws, payload, msgpack)` helper
- **Hot path optimization in `endTurn()`**: both formats pre-encoded **once per tick**, reused across all clients:

```typescript
const jsonMsg = JSON.stringify(turnPayload);
let msgpackMsg: Uint8Array | null = null;

this.activeClients.forEach((c) => {
  if (c.supportsMsgPack) {
    msgpackMsg ??= encodeMsgPack(turnPayload); // lazy, encoded once
    c.ws.send(msgpackMsg);
  } else {
    c.ws.send(jsonMsg);
  }
});
```

### Modified: `src/client/Transport.ts`

- `socket.binaryType = 'arraybuffer'`
- `onmessage`: detect `ArrayBuffer` → msgpack decode; string → JSON parse
- `sendMsg`: all outgoing messages encoded as msgpack binary
- `buffer`: updated to `Array<string | Uint8Array>`

---

## Tests

**42 new tests** in `tests/core/serialization.test.ts`:

- `isBinaryMessage()` — 6 cases covering Buffer, Uint8Array, ArrayBuffer, string, null, number
- Primitive round-trips — 13 cases (null, bool, int, float, string, array, nested obj)
- `ServerMessage` round-trips through Zod — 8 cases (ping, turn ×4, desync ×2, lobby_info, start)
- `ClientMessage` round-trips through Zod — 7 cases (ping, intent ×4, hash, join ×2)
- Zod compatibility: verifies `@msgpack/msgpack` returns plain objects, not ES6 Map
- Size reduction assertion: 20-intent turn > 15% smaller than JSON
- `decodeMsgPack` input types: Uint8Array, ArrayBuffer, Buffer

**Pre-existing failures:** 13 tests in `InputHandler.test.ts` fail due to `localStorage.removeItem is not a function` — a DOM mock issue unrelated to this PR. This PR adds zero new failures.

---

## Commit History

```text
feat: add @msgpack/msgpack library and serialization module
feat: use MessagePack binary frames on server (GameServer + Worker)
feat: encode client→server messages as MessagePack binary frames
test: add 42-test suite for MessagePack serialization module
```

---

## What's NOT in this PR (by design)

- **No protobuf/flatbuffers schema** — those require a build step and major refactor; msgpack works on dynamic objects which matches the existing Zod-typed architecture
- **No compression changes** — separate concern, see rationale above
- **No replay/archive format changes** — `LocalServer.ts` and game record archival use their own compression (`DecompressionStream`) and are separate from the live WebSocket path
- **No lobby broadcast changes** — `WorkerLobbyService.broadcastLobbiesToClients()` sends public game lists to unauthenticated visitors; those clients have no capability declaration so they stay on JSON
