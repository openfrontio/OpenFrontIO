// A map layer's PNG to the straight 8-bit RGBA its webps are encoded from.
import type { DecodedPNG } from "./png";

/** Top-left width x height of img as straight 8-bit RGBA (Go draw.Draw into *image.NRGBA). */
export function cropToNRGBA(
  img: DecodedPNG,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const w = Math.min(width, img.width);
  const h = Math.min(height, img.height);
  if (img.kind === "nrgba8") {
    for (let y = 0; y < h; y++) {
      out.set(
        img.pix.subarray(y * img.width * 4, (y * img.width + w) * 4),
        y * width * 4,
      );
    }
    return out;
  }
  // NRGBA.SetRGBA64: un-premultiply unless alpha is 0 or opaque.
  const pix = img.pix;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * img.width + x) * 4;
      const d = (y * width + x) * 4;
      let r = pix[s],
        g = pix[s + 1],
        b = pix[s + 2];
      const a = pix[s + 3];
      if (a !== 0 && a !== 0xffff) {
        r = Math.floor((r * 0xffff) / a);
        g = Math.floor((g * 0xffff) / a);
        b = Math.floor((b * 0xffff) / a);
      }
      out[d] = r >> 8;
      out[d + 1] = g >> 8;
      out[d + 2] = b >> 8;
      out[d + 3] = a >> 8;
    }
  }
  return out;
}

/** Alpha-weighted 2x2 box filter to width x height. */
export function downscaleHalf(
  src: Uint8Array,
  srcWidth: number,
  width: number,
  height: number,
): Uint8Array {
  const dst = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let dy = 0; dy < 2; dy++) {
        let i = ((2 * y + dy) * srcWidth + 2 * x) * 4;
        for (let dx = 0; dx < 2; dx++, i += 4) {
          const pa = src[i + 3];
          r += src[i] * pa;
          g += src[i + 1] * pa;
          b += src[i + 2] * pa;
          a += pa;
        }
      }
      if (a === 0) continue;
      const o = (y * width + x) * 4;
      const half = a >>> 1;
      dst[o] = Math.floor((r + half) / a);
      dst[o + 1] = Math.floor((g + half) / a);
      dst[o + 2] = Math.floor((b + half) / a);
      dst[o + 3] = (a + 2) >>> 2;
    }
  }
  return dst;
}
