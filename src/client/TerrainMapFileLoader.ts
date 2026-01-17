import { FetchGameMapLoader } from "../core/game/FetchGameMapLoader";

export const terrainMapFileLoader = new FetchGameMapLoader(
  `/maps`,
  window.GIT_COMMIT,
);
