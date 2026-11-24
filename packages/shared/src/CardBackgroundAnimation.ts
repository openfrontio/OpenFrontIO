import { z } from "zod/v4";

// How a card background animates. Artists make still images; the game moves
// them. Two kinds:
//  - "layers": up to 3 transparent images over the base (the background's
//    `url`), each with one effect, animated with CSS transform/opacity.
//  - "mask": one colour-coded mask for a WebGL shader (red pulse, green
//    shimmer, blue flow). Shown as the still base until the shader exists.
//
// The API keeps its own copy of this schema (it can't import this package):
// change both together.

export const FX_DEFAULTS = {
  // Pulse, shimmer and mask periods, seconds.
  period: 2.5,
  driftPeriod: 60,
  strength: 1,
  // Pulse opacity range.
  min: 0.3,
  max: 1,
  // Shimmer angle, degrees.
  angle: 20,
  rate: "medium",
  flowColour: "#5ff0ff",
} as const;

const PERIOD_MIN = 0.8;
const PERIOD_MAX = 10;
const DRIFT_PERIOD_MIN = 15;
const DRIFT_PERIOD_MAX = 180;

const PeriodSchema = z.number().min(PERIOD_MIN).max(PERIOD_MAX);
const StrengthSchema = z.number().min(0).max(1);
const AngleSchema = z.number().min(-90).max(90);
const HexColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const FxEffectSchema = z.enum(["pulse", "shimmer", "flicker", "drift"]);
export const FlickerRateSchema = z.enum(["low", "medium", "high"]);

export const FxLayerSchema = z
  .object({
    src: z.string(),
    effect: FxEffectSchema,
    // Seconds. Pulse and shimmer 0.8–10, drift 15–180; flicker uses `rate`.
    period: z.number().positive().optional(),
    strength: StrengthSchema.optional(),
    // Pulse only: the opacity range, min < max.
    min: z.number().min(0).max(1).optional(),
    max: z.number().min(0).max(1).optional(),
    // Shimmer only, degrees.
    angle: AngleSchema.optional(),
    // Flicker only.
    rate: FlickerRateSchema.optional(),
  })
  .superRefine((layer, ctx) => {
    if (layer.period !== undefined) {
      const [lo, hi] =
        layer.effect === "drift"
          ? [DRIFT_PERIOD_MIN, DRIFT_PERIOD_MAX]
          : layer.effect === "flicker"
            ? [0, Infinity]
            : [PERIOD_MIN, PERIOD_MAX];
      if (layer.period < lo || layer.period > hi) {
        ctx.addIssue({
          code: "custom",
          path: ["period"],
          message: `${layer.effect} period must be ${lo}–${hi} s`,
        });
      }
    }
    if (layer.effect === "pulse") {
      const min = layer.min ?? FX_DEFAULTS.min;
      const max = layer.max ?? FX_DEFAULTS.max;
      if (min >= max) {
        ctx.addIssue({
          code: "custom",
          path: ["min"],
          message: "pulse min must be below max",
        });
      }
    }
  });

export const LayerAnimationSchema = z.object({
  kind: z.literal("layers"),
  layers: z.array(FxLayerSchema).min(1).max(3),
});

export const MaskAnimationSchema = z.object({
  kind: z.literal("mask"),
  mask: z.string(),
  pulse: z
    .object({
      period: PeriodSchema.optional(),
      strength: StrengthSchema.optional(),
      glowColour: HexColourSchema.optional(),
      colourCycle: z.array(HexColourSchema).optional(),
    })
    .optional(),
  shimmer: z
    .object({
      period: PeriodSchema.optional(),
      strength: StrengthSchema.optional(),
      angle: AngleSchema.optional(),
      // In 2800 × 400 pixel coordinates.
      rippleCentre: z.tuple([z.number(), z.number()]).optional(),
    })
    .optional(),
  flow: z
    .object({
      period: PeriodSchema.optional(),
      strength: StrengthSchema.optional(),
      colour: HexColourSchema.optional(),
    })
    .optional(),
});

export const CardBackgroundAnimationSchema = z.discriminatedUnion("kind", [
  LayerAnimationSchema,
  MaskAnimationSchema,
]);

export type FxEffect = z.infer<typeof FxEffectSchema>;
export type FlickerRate = z.infer<typeof FlickerRateSchema>;
export type FxLayer = z.infer<typeof FxLayerSchema>;
export type LayerAnimation = z.infer<typeof LayerAnimationSchema>;
export type MaskAnimation = z.infer<typeof MaskAnimationSchema>;
export type CardBackgroundAnimation = z.infer<
  typeof CardBackgroundAnimationSchema
>;
