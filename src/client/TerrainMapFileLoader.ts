import { assetUrl } from "@openfront/shared/AssetUrls";
import { FetchGameMapLoader } from "@openfront/shared/FetchGameMapLoader";

export const terrainMapFileLoader = new FetchGameMapLoader((path) =>
  assetUrl(`maps/${path}`),
);
