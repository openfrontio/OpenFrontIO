import { Colord, colord } from "colord";

/**
 * A vision model that colour distinctness is evaluated against. "normal" is
 * unimpaired vision; the others are dichromatic colour vision deficiencies.
 */
export type Observer = "normal" | "protan" | "deutan" | "tritan";

const OBSERVER_NAMES: readonly string[] = [
  "normal",
  "protan",
  "deutan",
  "tritan",
];

/**
 * Machado, Oliveira & Fernandes (2009), "A Physiologically-based Model for
 * Simulation of Color Vision Deficiency", severity 1.0. Row-major 3x3, applied
 * to linear-light RGB — not to gamma-encoded sRGB.
 */
const CVD_MATRICES: Record<Exclude<Observer, "normal">, readonly number[]> = {
  protan: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882,
    -0.048116, 1.051998,
  ],
  deutan: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182,
    0.04294, 0.968881,
  ],
  tritan: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733,
    0.691367, 0.3039,
  ],
};

/** sRGB channel (0–255) to linear light (0–1). */
function toLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Linear light (0–1) back to an sRGB channel (0–255), clamped to gamut. */
function toSrgb(linear: number): number {
  const v =
    linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(255, Math.max(0, v * 255)));
}

/**
 * Narrow observer names read from a theme JSON. Throws on an unknown name so a
 * typo in theme data fails loudly at startup rather than silently disabling an
 * accessibility check.
 */
export function parseObservers(values: readonly string[]): Observer[] {
  if (values.length === 0) {
    throw new Error("Theme settings must list at least one observer");
  }
  return values.map((value) => {
    if (!OBSERVER_NAMES.includes(value)) {
      throw new Error(`Unknown observer "${value}" in theme settings`);
    }
    return value as Observer;
  });
}

/** `color` as seen by `observer`. Normal vision returns it unchanged. */
export function simulate(color: Colord, observer: Observer): Colord {
  if (observer === "normal") {
    return color;
  }
  const m = CVD_MATRICES[observer];
  const { r, g, b } = color.toRgb();
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  return colord({
    r: toSrgb(m[0] * lr + m[1] * lg + m[2] * lb),
    g: toSrgb(m[3] * lr + m[4] * lg + m[5] * lb),
    b: toSrgb(m[6] * lr + m[7] * lg + m[8] * lb),
  });
}

/** `color` as seen by each observer, in the order given. */
export function observerViews(
  color: Colord,
  observers: readonly Observer[],
): Colord[] {
  return observers.map((observer) => simulate(color, observer));
}
