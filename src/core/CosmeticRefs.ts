import { base64url } from "jose";
import { z } from "zod/v4";

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

export function decodePatternData(
  b64: string,
  base64urlDecode: (input: string) => Uint8Array,
): { height: number; width: number; scale: number; bytes: Uint8Array } {
  const bytes = base64urlDecode(b64);

  if (bytes.length < 3) {
    throw new Error("Pattern data is too short to contain required metadata.");
  }

  const version = bytes[0];
  if (version !== 0) {
    throw new Error(`Unrecognized pattern version ${version}.`);
  }

  const byte1 = bytes[1];
  const byte2 = bytes[2];
  const scale = byte1 & 0x07;

  const width = (((byte2 & 0x03) << 5) | ((byte1 >> 3) & 0x1f)) + 2;
  const height = ((byte2 >> 2) & 0x3f) + 2;

  const expectedBits = width * height;
  const expectedBytes = (expectedBits + 7) >> 3; // Equivalent to: ceil(expectedBits / 8);
  if (bytes.length - 3 < expectedBytes) {
    throw new Error("Pattern data is too short for the specified dimensions.");
  }

  return { height, width, scale, bytes };
}
