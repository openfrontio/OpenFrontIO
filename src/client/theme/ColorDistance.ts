import { LabaColor } from "colord";

/**
 * CIEDE2000 colour difference between two LAB colours, on the usual 0–100
 * scale.
 *
 * colord's lab plugin offers the same metric via `Colord.delta()`, but it
 * converts both operands from sRGB to LAB on every call. Colour allocation
 * compares one new colour against thousands of fixed candidates, so those
 * conversions dominate. Taking LAB directly lets callers convert once and
 * reuse the result.
 *
 * Validated against the Sharma, Wu & Dalal (2005) reference dataset in
 * tests/Colors.test.ts. That matters beyond performance: `Colord.delta()`
 * disagrees with the reference formula by up to ~2.5 on some near-neutral
 * pairs, so this is also the more accurate of the two.
 */
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
/** 25^7, the constant the chroma-weighting terms are scaled against. */
const POW_25_7 = 6103515625;

/** `value ** 7` by multiplication — this runs millions of times per lobby. */
function pow7(value: number): number {
  const cube = value * value * value;
  return cube * cube * value;
}

export function deltaE2000(first: LabaColor, second: LabaColor): number {
  const rad = RAD;
  const deg = DEG;

  const c1 = Math.hypot(first.a, first.b);
  const c2 = Math.hypot(second.a, second.b);
  const meanC = (c1 + c2) / 2;
  const meanC7 = pow7(meanC);
  const g = 0.5 * (1 - Math.sqrt(meanC7 / (meanC7 + POW_25_7)));

  const a1 = first.a * (1 + g);
  const a2 = second.a * (1 + g);
  const cp1 = Math.hypot(a1, first.b);
  const cp2 = Math.hypot(a2, second.b);

  const hue = (b: number, a: number): number => {
    if (b === 0 && a === 0) return 0;
    const h = Math.atan2(b, a) * deg;
    return h >= 0 ? h : h + 360;
  };
  const hp1 = hue(first.b, a1);
  const hp2 = hue(second.b, a2);

  const deltaL = second.l - first.l;
  const deltaC = cp2 - cp1;

  let deltaHue = 0;
  if (cp1 * cp2 !== 0) {
    deltaHue = hp2 - hp1;
    if (deltaHue > 180) deltaHue -= 360;
    else if (deltaHue < -180) deltaHue += 360;
  }
  const deltaH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((deltaHue / 2) * rad);

  const meanL = (first.l + second.l) / 2;
  const meanCp = (cp1 + cp2) / 2;

  let meanHp = hp1 + hp2;
  if (cp1 * cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) meanHp += hp1 + hp2 < 360 ? 360 : -360;
    meanHp /= 2;
  }

  const t =
    1 -
    0.17 * Math.cos((meanHp - 30) * rad) +
    0.24 * Math.cos(2 * meanHp * rad) +
    0.32 * Math.cos((3 * meanHp + 6) * rad) -
    0.2 * Math.cos((4 * meanHp - 63) * rad);

  const meanCp7 = pow7(meanCp);
  const dl = meanL - 50;
  const dl2 = dl * dl;
  const hueOffset = (meanHp - 275) / 25;
  const sl = 1 + (0.015 * dl2) / Math.sqrt(20 + dl2);
  const sc = 1 + 0.045 * meanCp;
  const sh = 1 + 0.015 * meanCp * t;
  const rt =
    -2 *
    Math.sqrt(meanCp7 / (meanCp7 + POW_25_7)) *
    Math.sin(60 * Math.exp(-(hueOffset * hueOffset)) * rad);

  const lTerm = deltaL / sl;
  const cTerm = deltaC / sc;
  const hTerm = deltaH / sh;

  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rt * cTerm * hTerm);
}
