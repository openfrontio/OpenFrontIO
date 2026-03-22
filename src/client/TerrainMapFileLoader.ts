import { assetUrl } from "../core/AssetUrls";
import { FetchGameMapLoader } from "../core/game/FetchGameMapLoader";

export const terrainMapFileLoader = new FetchGameMapLoader(() =>
  assetUrl("maps"),
);
