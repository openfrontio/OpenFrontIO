import { describe, expect, it } from "vitest";
import { atan2, exp, log, pow, pow2 } from "../../src/core/DetMath";

function relErr(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b);
}

describe("DetMath", () => {
  it("pow2 is exact for integer exponents", () => {
    for (let n = -1022; n <= 1023; n++) {
      expect(pow2(n)).toBe(2 ** n);
    }
  });

  it("exp matches Math.exp to 1e-8 across the useful range", () => {
    for (let x = -700; x <= 700; x += 0.37) {
      expect(relErr(exp(x), Math.exp(x))).toBeLessThan(1e-8);
    }
    expect(exp(0)).toBe(1);
    expect(exp(710)).toBe(Infinity);
    expect(exp(-800)).toBe(0);
  });

  it("log matches Math.log to 1e-8 across the useful range", () => {
    for (let p = -300; p <= 300; p += 0.61) {
      const x = 10 ** p;
      expect(relErr(log(x), Math.log(x))).toBeLessThan(1e-8);
    }
    for (let x = 0.5; x <= 4; x += 0.013) {
      expect(Math.abs(log(x) - Math.log(x))).toBeLessThan(1e-9);
    }
    expect(log(1)).toBe(0);
    expect(log(0)).toBe(-Infinity);
    expect(log(-1)).toBeNaN();
    expect(relErr(log(5e-324), Math.log(5e-324))).toBeLessThan(1e-8);
  });

  it("pow matches Math.pow to 1e-7 on game-sized inputs", () => {
    const bases = [0.5, 1, 2, 7.3, 100, 5000, 123_456, 1e6, 4e6, 1e9];
    const exps = [0, 0.15, 0.35, 0.5, 0.6, 0.73, 1, 2, 2.5];
    for (const x of bases) {
      for (const y of exps) {
        expect(relErr(pow(x, y), Math.pow(x, y))).toBeLessThan(1e-7);
      }
    }
    expect(pow(0, 0.6)).toBe(0);
    expect(pow(0, 0)).toBe(1);
    expect(pow(-2, 0.5)).toBeNaN();
  });

  it("atan2 matches Math.atan2 to 1e-7 radians in every quadrant", () => {
    for (let y = -20; y <= 20; y++) {
      for (let x = -20; x <= 20; x++) {
        expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-7);
      }
    }
    for (let t = -Math.PI + 1e-6; t < Math.PI; t += 0.0137) {
      const y = 1000 * Math.sin(t);
      const x = 1000 * Math.cos(t);
      expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-7);
    }
    expect(atan2(0, 1)).toBe(0);
    expect(atan2(0, -1)).toBe(Math.PI);
    expect(atan2(1, 0)).toBe(Math.PI / 2);
    expect(atan2(-1, 0)).toBe(-Math.PI / 2);
  });

  it("produces exactly these bits (guards against accidental changes)", () => {
    expect([
      exp(1),
      exp(-12.5),
      log(3),
      log(150_000),
      pow(50_000, 0.6),
      pow(1_234_567, 0.73),
      atan2(3, 4),
      atan2(-7, -2),
    ]).toMatchSnapshot();
  });
});
