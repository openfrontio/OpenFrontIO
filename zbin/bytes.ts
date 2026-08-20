// zbin — compact binary serialization for zod schemas.
// Byte-level primitives: a growable little-endian writer and a bounds-checked
// reader. No dependencies; safe for browser, worker, and Node.

export class ZbEncodeError extends Error {}
export class ZbDecodeError extends Error {}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export class ByteWriter {
  // Uint8Array<ArrayBuffer> (not ArrayBufferLike) so finished payloads are
  // directly accepted by WebSocket.send in the DOM typings.
  private buf: Uint8Array<ArrayBuffer>;
  private view: DataView;
  private pos = 0;

  constructor(initialCapacity = 64) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number): void {
    if (this.pos + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  get length(): number {
    return this.pos;
  }

  u8(b: number): void {
    this.ensure(1);
    this.buf[this.pos++] = b;
  }

  // Reserve n zeroed bytes (e.g. an object's presence-bit header) and return
  // their offset so they can be patched via orU8 after later fields are known.
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
    this.uint(n < 0 ? -2 * n - 1 : 2 * n);
  }

  f64(n: number): void {
    this.ensure(8);
    this.view.setFloat64(this.pos, n, true);
    this.pos += 8;
  }

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
    this.ensure(bytes.length);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  finish(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.pos);
  }
}

export class ByteReader {
  private view: DataView;
  private pos = 0;

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
      if ((b & 0x80) === 0) break;
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
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const b = this.u8();
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7n;
      if (shift > 1024n) throw new ZbDecodeError("bigint varint too large");
    }
    return result % 2n === 0n ? result / 2n : -(result + 1n) / 2n;
  }

  str(): string {
    const len = this.uint();
    this.need(len);
    const s = textDecoder.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
}
