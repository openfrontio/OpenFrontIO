/**
 * Cosmetic effects in a replay: coloured trails behind ships, nukes,
 * warships and trains, the glow on structures and railroads, and the
 * spiral nuke trail ribbons.
 *
 * The live client (WebGLFrameBuilder.syncPlayerEffects) and this write
 * them the same way, with writePlayerEffects. A replay has the equipped
 * cosmetics in the game start info, and the catalog is fetched from the
 * API as usual. If the catalog no longer has an effect it's skipped and
 * the trail uses the player's colour.
 */

import type { Cosmetics } from "../../core/CosmeticSchemas";
import type { PlayerCosmetics } from "../../core/Schemas";
import type { MapRenderer } from "../render/gl";
import {
  EFFECT_PALETTE_BLOCKS,
  MAX_TRAIL_COLORS,
} from "../render/gl/utils/ColorUtils";
import {
  catalogEffectAttributes,
  PALETTE_SIZE,
  writePlayerEffects,
  type SpiralSink,
} from "../render/gl/utils/PlayerPalette";
import type { PlayerStatic } from "../render/types";

/**
 * Resolve every player's effects and send them to the renderer, replacing
 * what was there before, so effects that got hidden are cleared.
 */
export function applyReplayEffects(
  view: MapRenderer,
  spirals: SpiralSink,
  players: readonly PlayerStatic[],
  cosmeticsByClientID: ReadonlyMap<string, PlayerCosmetics>,
  catalog: Cosmetics,
): void {
  const palette = new Float32Array(
    PALETTE_SIZE * MAX_TRAIL_COLORS * EFFECT_PALETTE_BLOCKS * 4,
  );
  for (const p of players) {
    const effects =
      p.clientID === null
        ? undefined
        : cosmeticsByClientID.get(p.clientID)?.effects;
    writePlayerEffects(
      palette,
      p.smallID,
      (effectType) => catalogEffectAttributes(catalog, effects, effectType),
      spirals,
    );
  }
  view.updateEffectPalette(palette);
}
