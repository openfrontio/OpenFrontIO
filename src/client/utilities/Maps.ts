import { GameMapType } from "../../core/game/Game";
import { getMapFileName } from "../../core/game/MapRegistry";

export function getMapsImage(map: GameMapType): string | null {
  const fileName = getMapFileName(map);
  if (!fileName) {
    console.warn(`Could not find filename for map ${map} in getMapsImage`);
    return null;
  }

  return `/maps/${fileName}Thumb.webp`;
}
