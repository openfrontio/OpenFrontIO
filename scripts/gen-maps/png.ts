// Minimal PNG decoder (non-interlaced) that reproduces the pixel values Go's
// image/png + image.Image.At().RGBA() hand the Go generator, so both produce
// byte-identical output.
//
// Go decodes RGBA8, GrayAlpha8 and tRNS-keyed RGB8/Gray8 PNGs to *image.NRGBA
// (straight alpha, 8 bits). We keep those as "nrgba8". Every other format
// (RGB8, Gray, palette, 16-bit) we expand to "rgba64": the premultiplied
// 16-bit values Go's RGBA()/RGBA64At() return for that image type.
import type { MapImage } from "@openfront/engine-lib/mapgen/GenerateMap";
import { crc32, inflateSync } from "node:zlib";

export type DecodedPNG = MapImage;

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

interface Header {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlace: number;
}

function readHeader(buf: Uint8Array): Header {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIGNATURE[i])
      throw new Error("png: invalid format: not a PNG file");
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (String.fromCharCode(...buf.subarray(12, 16)) !== "IHDR") {
    throw new Error("png: invalid format: missing IHDR");
  }
  return {
    width: dv.getUint32(16),
    height: dv.getUint32(20),
    depth: buf[24],
    colorType: buf[25],
    interlace: buf[28],
  };
}

/** Width and height from the IHDR chunk, like Go's image.DecodeConfig. */
export function decodePNGConfig(buf: Uint8Array): {
  width: number;
  height: number;
} {
  const h = readHeader(buf);
  return { width: h.width, height: h.height };
}

export function decodePNG(buf: Uint8Array): DecodedPNG {
  const h = readHeader(buf);
  const { width, height, depth, colorType } = h;
  if (h.interlace !== 0)
    throw new Error("png: interlaced PNGs are not supported");

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null; // r,g,b triples
  let trns: Uint8Array | null = null;
  let off = 8;
  while (off < buf.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...buf.subarray(off + 4, off + 8));
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = dv.getUint32(off + 8 + len);
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== crc) {
      throw new Error("png: invalid format: invalid checksum");
    }
    if (type === "IDAT") idat.push(data);
    else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IEND") break;
    off += 12 + len;
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined)
    throw new Error(`png: unsupported color type ${colorType}`);
  const bitsPP = channels * depth;
  const bpp = Math.max(1, bitsPP >> 3); // filter byte distance
  const stride = (width * bitsPP + 7) >> 3;

  const raw = inflateSync(idat.length === 1 ? idat[0] : Buffer.concat(idat));
  if (raw.length < (stride + 1) * height)
    throw new Error("png: not enough pixel data");
  unfilter(raw, stride, height, bpp);
  const row = (y: number) => (stride + 1) * y + 1;

  const n = width * height;
  // Straight-alpha 8-bit outputs (Go *image.NRGBA).
  if (
    depth === 8 &&
    (colorType === 6 ||
      colorType === 4 ||
      (trns && (colorType === 2 || colorType === 0)))
  ) {
    const pix = new Uint8Array(n * 4);
    for (let y = 0; y < height; y++) {
      let s = row(y);
      let d = y * width * 4;
      if (colorType === 6) {
        pix.set(raw.subarray(s, s + width * 4), d);
        continue;
      }
      for (let x = 0; x < width; x++, d += 4) {
        if (colorType === 4) {
          pix[d] = pix[d + 1] = pix[d + 2] = raw[s];
          pix[d + 3] = raw[s + 1];
          s += 2;
        } else if (colorType === 2) {
          const r = raw[s],
            g = raw[s + 1],
            b = raw[s + 2];
          pix[d] = r;
          pix[d + 1] = g;
          pix[d + 2] = b;
          pix[d + 3] =
            r === trns![1] && g === trns![3] && b === trns![5] ? 0 : 0xff;
          s += 3;
        } else {
          const v = raw[s];
          pix[d] = pix[d + 1] = pix[d + 2] = v;
          pix[d + 3] = v === trns![1] ? 0 : 0xff;
          s += 1;
        }
      }
    }
    return { kind: "nrgba8", width, height, pix };
  }
  if (colorType === 0 && depth < 8 && trns) {
    // Go also decodes low-bit tRNS gray to NRGBA, with the key scaled to 8 bits.
    const scale = { 1: 0xff, 2: 0x55, 4: 0x11 }[depth]!;
    const ty = (trns[1] * scale) & 0xff;
    const pix = new Uint8Array(n * 4);
    for (let y = 0; y < height; y++) {
      const s = row(y);
      for (let x = 0; x < width; x++) {
        const v = lowBits(raw, s, x, depth) * scale;
        const d = (y * width + x) * 4;
        pix[d] = pix[d + 1] = pix[d + 2] = v;
        pix[d + 3] = v === ty ? 0 : 0xff;
      }
    }
    return { kind: "nrgba8", width, height, pix };
  }

  // Everything else: premultiplied 16-bit, as Go's RGBA64At() returns it.
  const pix = new Uint16Array(n * 4);
  const premul = (c: number, a: number) => Math.floor((c * a) / 0xffff);
  if (colorType === 3) {
    if (!palette) throw new Error("png: missing PLTE");
    const np = palette.length / 3;
    const lut = new Uint16Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      // Out-of-range indices are opaque black, like Go.
      const r = i < np ? palette[3 * i] * 0x101 : 0;
      const g = i < np ? palette[3 * i + 1] * 0x101 : 0;
      const b = i < np ? palette[3 * i + 2] * 0x101 : 0;
      const a = trns && i < trns.length ? trns[i] * 0x101 : 0xffff;
      lut[4 * i] = premul(r, a);
      lut[4 * i + 1] = premul(g, a);
      lut[4 * i + 2] = premul(b, a);
      lut[4 * i + 3] = a;
    }
    for (let y = 0; y < height; y++) {
      const s = row(y);
      for (let x = 0; x < width; x++) {
        const idx = depth === 8 ? raw[s + x] : lowBits(raw, s, x, depth);
        pix.set(lut.subarray(4 * idx, 4 * idx + 4), (y * width + x) * 4);
      }
    }
    return { kind: "rgba64", width, height, pix };
  }
  for (let y = 0; y < height; y++) {
    const s = row(y);
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      let r: number,
        g: number,
        b: number,
        a = 0xffff;
      if (depth < 8) {
        r =
          g =
          b =
            lowBits(raw, s, x, depth) *
            { 1: 0xff, 2: 0x55, 4: 0x11 }[depth]! *
            0x101;
      } else if (depth === 8) {
        // colorType 0 or 2 without tRNS (opaque).
        if (colorType === 0) r = g = b = raw[s + x] * 0x101;
        else {
          r = raw[s + 3 * x] * 0x101;
          g = raw[s + 3 * x + 1] * 0x101;
          b = raw[s + 3 * x + 2] * 0x101;
        }
      } else {
        const p = s + x * channels * 2;
        const u16 = (i: number) => (raw[p + 2 * i] << 8) | raw[p + 2 * i + 1];
        if (colorType === 0 || colorType === 4) {
          r = g = b = u16(0);
          if (colorType === 4) a = u16(1);
          else if (trns && r === ((trns[0] << 8) | trns[1])) a = 0;
        } else {
          r = u16(0);
          g = u16(1);
          b = u16(2);
          if (colorType === 6) a = u16(3);
          else if (
            trns &&
            r === ((trns[0] << 8) | trns[1]) &&
            g === ((trns[2] << 8) | trns[3]) &&
            b === ((trns[4] << 8) | trns[5])
          ) {
            a = 0;
          }
        }
      }
      pix[d] = premul(r, a);
      pix[d + 1] = premul(g, a);
      pix[d + 2] = premul(b, a);
      pix[d + 3] = a;
    }
  }
  return { kind: "rgba64", width, height, pix };
}

function lowBits(
  raw: Uint8Array,
  rowStart: number,
  x: number,
  depth: number,
): number {
  const perByte = 8 / depth;
  const byte = raw[rowStart + Math.floor(x / perByte)];
  const shift = 8 - depth * ((x % perByte) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
}

function unfilter(
  raw: Uint8Array,
  stride: number,
  height: number,
  bpp: number,
): void {
  for (let y = 0; y < height; y++) {
    const ft = raw[(stride + 1) * y];
    const c = (stride + 1) * y + 1; // current row start
    const p = c - (stride + 1); // previous row start (invalid for y == 0)
    switch (ft) {
      case 0:
        break;
      case 1:
        for (let i = bpp; i < stride; i++)
          raw[c + i] = (raw[c + i] + raw[c + i - bpp]) & 0xff;
        break;
      case 2:
        if (y > 0)
          for (let i = 0; i < stride; i++)
            raw[c + i] = (raw[c + i] + raw[p + i]) & 0xff;
        break;
      case 3:
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? raw[c + i - bpp] : 0;
          const up = y > 0 ? raw[p + i] : 0;
          raw[c + i] = (raw[c + i] + ((left + up) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? raw[c + i - bpp] : 0;
          const b = y > 0 ? raw[p + i] : 0;
          const cc = i >= bpp && y > 0 ? raw[p + i - bpp] : 0;
          const pa = Math.abs(b - cc);
          const pb = Math.abs(a - cc);
          const pc = Math.abs(a + b - 2 * cc);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
          raw[c + i] = (raw[c + i] + pred) & 0xff;
        }
        break;
      default:
        throw new Error("png: invalid format: bad filter type");
    }
  }
}
