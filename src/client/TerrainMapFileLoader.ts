import version from "../assets/data/version.txt?raw";
import { FetchGameMapLoader } from "../core/game/FetchGameMapLoader";

export const terrainMapFileLoader = new FetchGameMapLoader(`/maps`, version);
