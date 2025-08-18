import { FetchGameMapLoader } from "../core/game/FetchGameMapLoader";
import version from "../../resources/version.txt";

export const terrainMapFileLoader = new FetchGameMapLoader(`/maps`, version);
