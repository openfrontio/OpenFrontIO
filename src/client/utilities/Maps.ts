import africa from "../../../resources/maps/AfricaThumb.png";
import asia from "../../../resources/maps/AsiaThumb.png";
import australia from "../../../resources/maps/AustraliaThumb.png";
import blackSea from "../../../resources/maps/BlackSeaThumb.png";
import britannia from "../../../resources/maps/BritanniaThumb.png";
import europe from "../../../resources/maps/EuropeThumb.png";
import gatewayToTheAtlantic from "../../../resources/maps/GatewayToTheAtlanticThumb.png";
import iceland from "../../../resources/maps/IcelandThumb.png";
import mars from "../../../resources/maps/MarsThumb.png";
import mena from "../../../resources/maps/MenaThumb.png";
import northAmerica from "../../../resources/maps/NorthAmericaThumb.png";
import oceania from "../../../resources/maps/OceaniaThumb.png";
import pangaea from "../../../resources/maps/PangaeaThumb.png";
import southAmerica from "../../../resources/maps/SouthAmericaThumb.png";
import world from "../../../resources/maps/WorldMapThumb.png";

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
    case GameMapType.Pangaea:
      return pangaea;
    case GameMapType.Asia:
      return asia;
    case GameMapType.Mars:
      return mars;
    case GameMapType.Britannia:
      return britannia;
    case GameMapType.GatewayToTheAtlantic:
      return gatewayToTheAtlantic;
    case GameMapType.Australia:
      return australia;
    case GameMapType.Iceland:
      return iceland;
    default:
      return "";
  }
}
