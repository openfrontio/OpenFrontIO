import type { GameMap } from "../../../core/game/GameMap";

/**
 * A map's terrain bytes (GameMap.terrainByte), row-major. Replays record
 * terrain changes relative to these, and the viewer applies them on top.
 */
export function terrainOf(map: GameMap): Uint8Array {
  const out = new Uint8Array(map.width() * map.height());
  for (let ref = 0; ref < out.length; ref++) out[ref] = map.terrainByte(ref);
  return out;
}
