import { assetUrl } from "engine/AssetUrls";
import { FetchGameMapLoader } from "engine/game/FetchGameMapLoader";

export const terrainMapFileLoader = new FetchGameMapLoader((path) =>
  assetUrl(`maps/${path}`),
);
