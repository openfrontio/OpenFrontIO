import { FetchGameMapLoader } from "../core/game/FetchGameMapLoader";
import { GameMapType } from "../core/game/Game";
import { GameMapLoader } from "../core/game/GameMapLoader";

let mapLoader: GameMapLoader | null = null;

// Gets or creates the map loader, uses FetchGameMapLoader pointing to the master server.
function getMapLoader(): GameMapLoader {
  mapLoader ??= new FetchGameMapLoader("http://localhost:3000/maps");
  return mapLoader;
}

// Gets the number of land tiles for a map
// FetchGameMapLoader already caches maps, so no need for additional caching here.
export async function getMapLandTiles(map: GameMapType): Promise<number> {
  try {
    const loader = getMapLoader();
    const mapData = loader.getMapData(map);
    const manifest = await mapData.manifest();
    return manifest.map.num_land_tiles;
  } catch (error) {
    console.error(`Failed to load manifest for ${map}:`, error);
    return 1_000_000; // Default fallback
  }
}
