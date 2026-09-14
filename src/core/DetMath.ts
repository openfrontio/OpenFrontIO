/**
 * Deterministic replacements for the transcendental Math functions.
 *
 * The JS spec only requires Math.exp/log/pow/atan2 to be "implementation
 * approximated", and engines differ in the last bit. The simulation runs on
 * every client and compares hashes, so a one-bit difference that lands on a
 * truncation boundary (toInt on troops, floor on gold, the nuke edge) is a
 * desync. These versions use only + - * / and bit views, which IEEE 754
 * requires to be correctly rounded, so every engine produces the same bits.
 *
 * Accuracy is about 1e-8 relative, which is plenty for game curves. Inputs
 * are assumed finite; negative bases for pow are not supported.
 */

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
f64[0] = 1;
/** Index of the high word (sign, exponent, top mantissa bits) in u32. */
const HI = u32[1] === 0x3ff00000 ? 1 : 0;
const LO = 1 - HI;

const LN2 = 0.6931471805599453;
const LOG2E = 1.4426950408889634;
const SQRT2 = 1.4142135623730951;
const PI = 3.141592653589793;
const PI_2 = 1.5707963267948966;
const PI_4 = 0.7853981633974483;
const TAN_PI_8 = 0.41421356237309503;

/** 2 ** n for integer n; exact, saturating to Infinity / 0 like Math.pow. */
export function pow2(n: number): number {
  if (n > 1023) return Infinity;
  if (n < -1022) return 0;
  u32[HI] = (n + 1023) << 20;
  u32[LO] = 0;
  return f64[0];
}

/** e ** x. */
export function exp(x: number): number {
  if (x > 709) return Infinity;
  if (x < -708) return 0;
  // x = n ln2 + r, |r| <= ln2 / 2
  const n = Math.floor(x * LOG2E + 0.5);
  const r = x - n * LN2;
  // Taylor to r^8; the next term is below 1e-9 relative at |r| <= 0.35.
  const p =
    1 +
    r *
      (1 +
        r *
          (1 / 2 +
            r *
              (1 / 6 +
                r *
                  (1 / 24 +
                    r *
                      (1 / 120 +
                        r * (1 / 720 + r * (1 / 5040 + r * (1 / 40320))))))));
  return p * pow2(n);
}

/** Natural log of x > 0. */
export function log(x: number): number {
  if (x <= 0) return x === 0 ? -Infinity : NaN;
  let e = 0;
  if (x < 2.2250738585072014e-308) {
    // Subnormal: scale into the normal range first.
    x *= 18014398509481984; // 2 ** 54
    e = -54;
  }
  f64[0] = x;
  e += ((u32[HI] >>> 20) & 0x7ff) - 1023;
  u32[HI] = (u32[HI] & 0x000fffff) | 0x3ff00000;
  let m = f64[0]; // [1, 2)
  if (m > SQRT2) {
    m *= 0.5;
    e += 1;
  }
  // log(m) = 2 atanh(s), s = (m - 1) / (m + 1), |s| <= 0.172
  const s = (m - 1) / (m + 1);
  const z = s * s;
  const series =
    1 +
    z *
      (1 / 3 +
        z * (1 / 5 + z * (1 / 7 + z * (1 / 9 + z * (1 / 11 + z * (1 / 13))))));
  return e * LN2 + 2 * s * series;
}

/** x ** y for x >= 0. */
export function pow(x: number, y: number): number {
  if (y === 0 || x === 1) return 1;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) return NaN;
  return exp(y * log(x));
}

/** atan(z) for z in [0, 1]. */
function atanUnit(z: number): number {
  // Fold [tan(pi/8), 1] onto [-tan(pi/8), tan(pi/8)] around pi/4.
  let base = 0;
  if (z > TAN_PI_8) {
    base = PI_4;
    z = (z - 1) / (z + 1);
  }
  // Taylor to z^17; next term is below 2e-8 at |z| <= 0.4142.
  const w = z * z;
  const series =
    1 -
    w *
      (1 / 3 -
        w *
          (1 / 5 -
            w *
              (1 / 7 -
                w *
                  (1 / 9 -
                    w * (1 / 11 - w * (1 / 13 - w * (1 / 15 - w / 17)))))));
  return base + z * series;
}

/** Angle of (x, y) in (-pi, pi], like Math.atan2 (ignoring signed zeros). */
export function atan2(y: number, x: number): number {
  if (y === 0) return x >= 0 ? 0 : PI;
  if (x === 0) return y > 0 ? PI_2 : -PI_2;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  let a = ay <= ax ? atanUnit(ay / ax) : PI_2 - atanUnit(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}
