import { z } from "zod";

export const GraphicsOverridesSchema = z
  .object({
    name: z
      .object({
        nameScaleFactor: z.number(),
        cullThreshold: z.number(),
        darkNames: z.boolean(),
      })
      .partial(),
    structure: z
      .object({
        classicIcons: z.boolean(),
      })
      .partial(),
    mapOverlay: z
      .object({
        highlightFillBrighten: z.number(),
        highlightBrighten: z.number(),
        highlightThicken: z.number(),
        territorySaturation: z.number(),
        territoryAlpha: z.number(),
      })
      .partial(),
    railroad: z
      .object({
        railMinZoom: z.number(),
      })
      .partial(),
    passEnabled: z
      .object({
        fx: z.boolean(),
      })
      .partial(),
  })
  .partial();

export type GraphicsOverrides = z.infer<typeof GraphicsOverridesSchema>;
