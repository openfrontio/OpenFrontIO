/** Little-endian binary reader, the counterpart of BinaryWriter. */

import { unzigzag } from "./BinaryWriter";

const decoder = new TextDecoder();

export class BinaryReader {
  private view: DataView;
  private u8: Uint8Array;
  private pos = 0;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.u8 = bytes;
  }

  get offset(): number {
    return this.pos;
  }

  get length(): number {
    return this.view.byteLength;
  }

  seek(pos: number): void {
    this.pos = pos;
  }

  readU8(): number {
    const val = this.view.getUint8(this.pos);
    this.pos += 1;
    return val;
  }

  readU16(): number {
    const val = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return val;
  }

  readI32(): number {
    const val = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return val;
  }

  readU32(): number {
    const val = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return val;
  }

  readF64(): number {
    const val = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return val;
  }

  /** Unsigned LEB128 (see BinaryWriter.writeVarUint). */
  readVarUint(): number {
    let val = 0;
    let scale = 1;
    for (;;) {
      if (this.pos >= this.u8.length) {
        throw new RangeError(`varuint overruns ${this.u8.length}`);
      }
      const b = this.u8[this.pos++];
      val += (b & 0x7f) * scale;
      if (b < 0x80) return val;
      scale *= 0x80;
      if (scale > 2 ** 56) throw new RangeError("varuint too long");
    }
  }

  /** Zigzag LEB128 (see BinaryWriter.writeVarInt). */
  readVarInt(): number {
    return unzigzag(this.readVarUint());
  }

  /** A view into the buffer, not a copy. */
  readBytes(length: number): Uint8Array {
    if (this.pos + length > this.u8.length) {
      throw new RangeError(
        `read of ${length} bytes at ${this.pos} overruns ${this.u8.length}`,
      );
    }
    const view = this.u8.subarray(this.pos, this.pos + length);
    this.pos += length;
    return view;
  }

  readShortString(): string {
    return decoder.decode(this.readBytes(this.readU8()));
  }

  readLongString(): string {
    return decoder.decode(this.readBytes(this.readU32()));
  }
}
