import world from "../../../resources/maps/WorldMapThumb.png";
import oceania from "../../../resources/maps/OceaniaThumb.png";
import europe from "../../../resources/maps/EuropeThumb.png";
import mena from "../../../resources/maps/MenaThumb.png";
import northAmerica from "../../../resources/maps/NorthAmericaThumb.png";
import southAmerica from "../../../resources/maps/SouthAmericaThumb.png";
import blackSea from "../../../resources/maps/BlackSeaThumb.png";
import africa from "../../../resources/maps/AfricaThumb.png";
import asia from "../../../resources/maps/AsiaThumb.png";
import mars from "../../../resources/maps/MarsThumb.png";
import britannia from "../../../resources/maps/BritanniaThumb.png";
import gatewayToTheAtlantic from "../../../resources/maps/GatewayToTheAtlanticThumb.png";

import { GameMapType } from "../../core/game/Game";

export function getMapsImage(map: GameMapType): string {
  switch (map) {
    case GameMapType.World:
      return world;
    case GameMapType.Oceania:
      return oceania;
    case GameMapType.Europe:
      return europe;
    case GameMapType.Mena:
      return mena;
    case GameMapType.NorthAmerica:
      return northAmerica;
    case GameMapType.SouthAmerica:
      return southAmerica;
    case GameMapType.BlackSea:
      return blackSea;
    case GameMapType.Africa:
      return africa;
    case GameMapType.Asia:
      return asia;
    case GameMapType.Mars:
      return mars;
    case GameMapType.Britannia:
      return britannia;
    case GameMapType.GatewayToTheAtlantic:
      return gatewayToTheAtlantic;
    default:
      return "";
  }
}
