import { base64url } from "jose";
import { z } from "zod/v4";
import { decodePatternData } from "./PatternDecoder";

export const CosmeticNameSchema = z
  .string()
  .regex(/^[a-z0-9_]+$/)
  .max(32);

export const PatternDataSchema = z
  .string()
  .max(1403)
  .base64url()
  .refine(
    (val) => {
      try {
        decodePatternData(val, base64url.decode);
        return true;
      } catch (e) {
        if (e instanceof Error) {
          console.error(JSON.stringify(e.message, null, 2));
        } else {
          console.error(String(e));
        }
        return false;
      }
    },
    {
      message: "Invalid pattern",
    },
  );

export const ColorPaletteSchema = z.object({
  name: z.string(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
});

// "effects" is a cosmetic category alongside skins/flags. The catalog is nested
// effects[effectType][effectName], and each effect also carries an effectType
// field matching its outer key (so an Effect can stand alone / discriminate).
// effectTypes are listed explicitly in CosmeticsSchema so each type's attributes
// stay precisely typed; an effectType the client doesn't list is dropped at parse
// (the UI only handles EFFECT_TYPES), so a new server-side effectType never fails
// the whole cosmetics parse.
export const EFFECT_TYPES = [
  "transportShipTrail",
  "nukeTrail",
  "nukeExplosion",
  "structures",
  "warship",
  "train",
  "railroad",
] as const;

export const EffectTypeSchema = z.enum(EFFECT_TYPES);
