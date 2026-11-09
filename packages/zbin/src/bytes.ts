// zbin — compact binary serialization for zod schemas.
// Byte-level primitives: a growable little-endian writer and a bounds-checked
// reader. No dependencies; safe for browser, worker, and Node.

// `cause` is set by hand rather than via super(msg, {cause}): the repo targets
// ES2020, whose Error constructor takes no options bag.
interface ZbErrorOptions {
  cause?: unknown;
}

export class ZbEncodeError extends Error {
  override readonly name = "ZbEncodeError";
  constructor(message: string, options?: ZbErrorOptions) {
    super(message);
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class ZbDecodeError extends Error {
  override readonly name = "ZbDecodeError";
  constructor(message: string, options?: ZbErrorOptions) {
    super(message);
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

const textEncoder = new TextEncoder();
// fatal: invalid UTF-8 must surface as ZbDecodeError rather than silently
// becoming U+FFFD — a decoder that "succeeds" on garbage hides corruption.
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

// Zigzag doubles the magnitude, so |n| must stay within 2^52 to stay exact.
const MAX_INT_MAGNITUDE = 0xfffffffffffff; // 2^52 - 1

// Bigints are varint-encoded 7 bits at a time. The reader refuses to grow one
// past this many bits; the writer enforces the same bound so a value can never
// be encoded that no peer (including the sender) could read back.
export const MAX_BIGINT_BITS = 1024;

// Total decoded collection elements allowed per message. This is a whole-
// message budget rather than a per-collection cap: elements that encode to
// zero bytes (single-value literals, all-literal objects) would otherwise let
// a handful of input bytes drive an unbounded number of allocations.
export const MAX_DECODE_ITEMS = 1 << 20;

// Guards recursive schemas (z.lazy). Each level of nesting costs an attacker
// one byte, so without this a few KB of input overflows the JS stack with a
// RangeError — which would escape the ZbDecodeError contract.
export const MAX_DECODE_DEPTH = 64;

export class ByteWriter {
  // Uint8Array<ArrayBuffer> (not ArrayBufferLike) so finished payloads are
  // directly accepted by WebSocket.send in the DOM typings.
  private buf: Uint8Array<ArrayBuffer>;
  private view: DataView;
  private pos = 0;

  constructor(initialCapacity = 64) {
    // Math.max keeps a 0 (or negative) capacity from making `ensure`'s
    // doubling loop spin forever.
    this.buf = new Uint8Array(Math.max(1, initialCapacity));
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number): void {
    if (this.pos + extra <= this.buf.length) return;
    let cap = Math.max(this.buf.length * 2, 16);
    while (cap < this.pos + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  get length(): number {
    return this.pos;
  }

  // Rewind for reuse. Callers that pool a writer must treat previously
  // returned buffers as owned by the caller (finish() copies).
  reset(): void {
    this.pos = 0;
  }

  u8(b: number): void {
    this.ensure(1);
    this.buf[this.pos++] = b;
  }

  // Reserve n zeroed bytes (e.g. an object's presence-bit header) and return
  // their offset so they can be patched via orU8 after later fields are known.
  // The explicit fill matters for a pooled writer, whose backing bytes are not
  // freshly zeroed.
  reserve(n: number): number {
    this.ensure(n);
    const at = this.pos;
    this.buf.fill(0, at, at + n);
    this.pos += n;
    return at;
  }

  orU8(offset: number, mask: number): void {
    this.buf[offset] |= mask;
  }

  // Unsigned LEB128. Arithmetic (not bitwise) so values past 2^31 survive;
  // full double-precision integer range [0, 2^53).
  uint(n: number): void {
    if (!Number.isInteger(n) || n < 0 || n > MAX_SAFE) {
      throw new ZbEncodeError(`not an encodable unsigned integer: ${n}`);
    }
    while (n >= 0x80) {
      this.u8((n % 0x80) + 0x80);
      n = Math.floor(n / 0x80);
    }
    this.u8(n);
  }

  // Zigzag varint. |n| must stay within 2^52 so the doubled value is exact.
  int(n: number): void {
    if (!Number.isInteger(n)) {
      throw new ZbEncodeError(`not an encodable integer: ${n}`);
    }
    if (n > MAX_INT_MAGNITUDE || n < -MAX_INT_MAGNITUDE - 1) {
      throw new ZbEncodeError(
        `integer ${n} is outside the encodable range +/-2^52`,
      );
    }
    this.uint(n < 0 ? -2 * n - 1 : 2 * n);
  }

  f64(n: number): void {
    this.ensure(8);
    this.view.setFloat64(this.pos, n, true);
    this.pos += 8;
  }

  bigint(n: bigint): void {
    if (typeof n !== "bigint") {
      throw new ZbEncodeError(`not an encodable bigint: ${String(n)}`);
    }
    // Fast path: inside the safe-integer range the zigzag LEB128 bytes are
    // identical to the number path, without allocating a BigInt per 7 bits.
    if (n >= -0xfffffffffffffn && n <= 0xfffffffffffffn) {
      this.int(Number(n));
      return;
    }
    let u = n < 0n ? -2n * n - 1n : 2n * n;
    // Bound the zigzagged value, not the magnitude: zigzag adds a bit, and it
    // is the encoded value's width that the reader's limit applies to.
    if (u >> BigInt(MAX_BIGINT_BITS) !== 0n) {
      throw new ZbEncodeError(
        `bigint magnitude exceeds the ${MAX_BIGINT_BITS}-bit wire limit`,
      );
    }
    while (u >= 0x80n) {
      this.u8(Number(u & 0x7fn) | 0x80);
      u >>= 7n;
    }
    this.u8(Number(u));
  }

  str(s: string): void {
    if (typeof s !== "string") {
      throw new ZbEncodeError(`not an encodable string: ${String(s)}`);
    }
    const n = s.length;
    // Worst case 3 UTF-8 bytes per UTF-16 unit (surrogate pairs are 2 units ->
    // 4 bytes, still under 3/unit), plus the largest length varint we'd write.
    this.ensure(n * 3 + 5);
    const buf = this.buf;
    const start = this.pos;
    // Optimistic ASCII: byte length equals n, so the length prefix is known up
    // front and the characters go straight into the buffer with no
    // intermediate Uint8Array allocation.
    this.uint(n);
    const p = this.pos;
    let i = 0;
    for (; i < n; i++) {
      const c = s.charCodeAt(i);
      if (c > 0x7f) break;
      buf[p + i] = c;
    }
    if (i === n) {
      this.pos = p + n;
      return;
    }
    // Non-ASCII: rewind, encode past the widest possible length prefix, then
    // shift the payload down now that the true byte length is known.
    this.pos = start;
    const written = textEncoder.encodeInto(s, buf.subarray(start + 5)).written;
    this.uint(written);
    buf.copyWithin(this.pos, start + 5, start + 5 + written);
    this.pos += written;
  }

  finish(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.pos);
  }
}

export class ByteReader {
  private view: DataView;
  private pos = 0;
  private items = 0;
  private depth = 0;

  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new ZbDecodeError("unexpected end of input");
    }
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  // Charge decoded elements against the per-message budget. Collections whose
  // elements encode to zero bytes cannot be bounded by remaining input alone.
  takeItems(n: number, path: string): void {
    this.items += n;
    if (this.items > MAX_DECODE_ITEMS) {
      throw new ZbDecodeError(
        `${path}: decoded element budget of ${MAX_DECODE_ITEMS} exceeded`,
      );
    }
  }

  enterDepth(path: string): void {
    if (++this.depth > MAX_DECODE_DEPTH) {
      throw new ZbDecodeError(
        `${path}: nesting deeper than ${MAX_DECODE_DEPTH} levels`,
      );
    }
  }

  exitDepth(): void {
    this.depth--;
  }

  expectEnd(): void {
    if (this.remaining !== 0) {
      throw new ZbDecodeError(`${this.remaining} trailing byte(s) after value`);
    }
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  readBytes(n: number): Uint8Array {
    this.need(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  uint(): number {
    let result = 0;
    let mult = 1;
    for (;;) {
      const b = this.u8();
      result += (b & 0x7f) * mult;
      if ((b & 0x80) === 0) {
        // Reject non-minimal encodings: a trailing zero group adds nothing, so
        // accepting it would give one value many valid byte strings and break
        // byte-equality of encoded messages (replay hashes, dedupe).
        if (b === 0 && mult !== 1) {
          throw new ZbDecodeError("non-minimal varint encoding");
        }
        break;
      }
      mult *= 0x80;
      if (mult > MAX_SAFE) throw new ZbDecodeError("varint too large");
    }
    if (result > MAX_SAFE) throw new ZbDecodeError("varint too large");
    return result;
  }

  int(): number {
    const u = this.uint();
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  bigint(): bigint {
    // Accumulate in a number while the value still fits exactly, and only
    // promote to BigInt for genuinely large values. Mirrors the writer's fast
    // path; the bytes are identical either way.
    let small = 0;
    let mult = 1;
    let shift = 0;
    for (;;) {
      const b = this.u8();
      if ((b & 0x80) === 0) {
        if (b === 0 && shift !== 0) {
          throw new ZbDecodeError("non-minimal varint encoding");
        }
        small += (b & 0x7f) * mult;
        const u = BigInt(small);
        return u % 2n === 0n ? u / 2n : -(u + 1n) / 2n;
      }
      small += (b & 0x7f) * mult;
      mult *= 0x80;
      shift += 7;
      if (shift >= 49) break; // past exact double range — finish with BigInt
    }
    let result = BigInt(small);
    let bshift = BigInt(shift);
    for (;;) {
      const b = this.u8();
      result |= BigInt(b & 0x7f) << bshift;
      if ((b & 0x80) === 0) {
        if (b === 0) throw new ZbDecodeError("non-minimal varint encoding");
        break;
      }
      bshift += 7n;
      if (bshift > BigInt(MAX_BIGINT_BITS)) {
        throw new ZbDecodeError("bigint varint too large");
      }
    }
    return result % 2n === 0n ? result / 2n : -(result + 1n) / 2n;
  }

  str(): string {
    const len = this.uint();
    this.need(len);
    try {
      return textDecoder.decode(this.buf.subarray(this.pos, this.pos + len));
    } catch (e) {
      throw new ZbDecodeError("invalid UTF-8 in string", { cause: e });
    } finally {
      this.pos += len;
    }
  }
}
