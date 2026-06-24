import { z } from "zod";

export const GraphicsOverridesSchema = z
  .object({
    name: z
      .object({
        nameScaleFactor: z.number(),
        cullThreshold: z.number(),
        darkNames: z.boolean(),
        hoverFadeAlpha: z.number(),
        hoverGlowWidth: z.number(),
        hoverGlowAlpha: z.number(),
      })
      .partial(),
    structure: z
      .object({
        iconSize: z.number(),
        classicIcons: z.boolean(),
        classicNumbers: z.boolean(),
        // When false, structures keep their full icon at any zoom instead of
        // collapsing to dots when zoomed out (forces dotsZoomThreshold to 0).
        showDots: z.boolean(),
      })
      .partial(),
    mapOverlay: z
      .object({
        highlightFillBrighten: z.number(),
        highlightBrighten: z.number(),
        highlightThicken: z.number(),
        territorySaturation: z.number(),
        territoryAlpha: z.number(),
        coordinateGridOpacity: z.number(),
        // "#rrggbb" hex string; overrides the lingering fallout ground tint
        // left on territory after a nuke.
        staleNukeColor: z.string(),
      })
      .partial(),
    railroad: z
      .object({
        railMinZoom: z.number(),
        railThickness: z.number(),
      })
      .partial(),
    passEnabled: z
      .object({
        fx: z.boolean(),
        // Nuclear fallout effects: the broiling green territory bloom and its
        // light emission in day/night mode. Disable to improve performance.
        fallout: z.boolean(),
      })
      .partial(),
    accessibility: z
      .object({
        colorblind: z.boolean(),
      })
      .partial(),
    terrain: z
      .object({
        // "#rrggbb" hex string; overrides the base ocean (deep water) color.
        oceanColor: z.string(),
      })
      .partial(),
    lighting: z
      .object({
        // Scene brightness multiplier in the day/night composite. <1 darkens
        // the map and reveals the glow around structures/units; 1 is identity.
        ambient: z.number(),
        // Exponent controlling how sharply a light fades with distance.
        falloffPower: z.number(),
      })
      .partial(),
  })
  .partial();

export type GraphicsOverrides = z.infer<typeof GraphicsOverridesSchema>;
