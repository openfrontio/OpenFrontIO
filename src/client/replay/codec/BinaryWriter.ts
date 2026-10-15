/** Little-endian binary writer with a buffer that grows as needed. */

const INITIAL_SIZE = 1024 * 1024;

/** Zigzag mapping (0, -1, 1, -2, … → 0, 1, 2, 3, …). */
export const zigzag = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
export const unzigzag = (z: number) => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);
const encoder = new TextEncoder();

export class BinaryWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private u8: Uint8Array;
  private pos = 0;

  constructor(initialSize = INITIAL_SIZE) {
    this.buf = new ArrayBuffer(Math.max(16, initialSize));
    this.view = new DataView(this.buf);
    this.u8 = new Uint8Array(this.buf);
  }

  /** Current write position (byte offset). */
  get offset(): number {
    return this.pos;
  }

  /** The bytes written so far (a view, not a copy). */
  finish(): Uint8Array {
    return new Uint8Array(this.buf, 0, this.pos);
  }

  private ensure(bytes: number): void {
    if (this.pos + bytes <= this.buf.byteLength) return;
    let newSize = this.buf.byteLength;
    while (newSize < this.pos + bytes) newSize *= 2;
    const newBuf = new ArrayBuffer(newSize);
    new Uint8Array(newBuf).set(this.u8);
    this.buf = newBuf;
    this.view = new DataView(this.buf);
    this.u8 = new Uint8Array(this.buf);
  }

  writeU8(val: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos, val);
    this.pos += 1;
  }

  writeU16(val: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, val, true);
    this.pos += 2;
  }

  writeI32(val: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, val, true);
    this.pos += 4;
  }

  writeU32(val: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, val >>> 0, true);
    this.pos += 4;
  }

  writeF64(val: number): void {
    this.ensure(8);
    this.view.setFloat64(this.pos, val, true);
    this.pos += 8;
  }

  /**
   * Unsigned LEB128: 7 bits per byte, lowest first, high bit set when more
   * bytes follow. Takes any non-negative safe integer, values under 128 are
   * one byte.
   */
  writeVarUint(val: number): void {
    if (!Number.isSafeInteger(val) || val < 0) {
      throw new RangeError(`varuint out of range: ${val}`);
    }
    this.ensure(8);
    while (val >= 0x80) {
      this.u8[this.pos++] = (val % 0x80) | 0x80;
      val = Math.floor(val / 0x80);
    }
    this.u8[this.pos++] = val;
  }

  /** Zigzag-mapped LEB128 (0, -1, 1, -2, … → 0, 1, 2, 3, …). */
  writeVarInt(val: number): void {
    if (!Number.isSafeInteger(val) || Math.abs(val) > 2 ** 51) {
      throw new RangeError(`varint out of range: ${val}`);
    }
    this.writeVarUint(zigzag(val));
  }

  writeBytes(data: Uint8Array): void {
    this.ensure(data.length);
    this.u8.set(data, this.pos);
    this.pos += data.length;
  }

  /** UTF-8 string with a u8 byte-length prefix. */
  writeShortString(str: string): void {
    const encoded = encoder.encode(str);
    if (encoded.length > 255) {
      throw new Error(
        `String too long for short encoding: ${encoded.length} bytes`,
      );
    }
    this.writeU8(encoded.length);
    this.writeBytes(encoded);
  }

  /** UTF-8 string with a u32 byte-length prefix. */
  writeLongString(str: string): void {
    const encoded = encoder.encode(str);
    this.writeU32(encoded.length);
    this.writeBytes(encoded);
  }
}
