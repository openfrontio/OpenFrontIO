import { FetchGameMapLoader } from "@openfront/engine-lib/game/FetchGameMapLoader";
import { assetUrl } from "@openfront/shared/AssetUrls";

export const terrainMapFileLoader = new FetchGameMapLoader((path) =>
  assetUrl(`maps/${path}`),
);
