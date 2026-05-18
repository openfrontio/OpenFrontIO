/**
 * Tile state bit layout (R16UI). Single source of truth for TypeScript + GLSL.
 *
 *   Bits 0-11:  ownerID (player smallID, 0 = unowned)
 *   Bit 13:     fallout
 *   Bit 14:     defense bonus
 */

export const OWNER_MASK = 0xfff; // bits 0-11
export const FALLOUT_BIT = 1 << 13; // bit 13
export const DEFENSE_BIT = 1 << 14; // bit 14

/** GLSL #define values for shaderSrc() injection. Bit indices, not masks. */
export const TILE_DEFINES = {
  OWNER_MASK: 0xfff, // used as uint(OWNER_MASK) in GLSL
  FALLOUT_BIT: 13, // used as (1u << FALLOUT_BIT) in GLSL
  DEFENSE_BIT: 14, // used as (1u << DEFENSE_BIT) in GLSL
};
