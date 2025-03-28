import world from "../../../resources/maps/WorldMapThumb.webp";
import oceania from "../../../resources/maps/OceaniaThumb.webp";
import europe from "../../../resources/maps/EuropeThumb.webp";
import mena from "../../../resources/maps/MenaThumb.webp";
import northAmerica from "../../../resources/maps/NorthAmericaThumb.webp";
import southAmerica from "../../../resources/maps/SouthAmericaThumb.webp";
import blackSea from "../../../resources/maps/BlackSeaThumb.webp";
import africa from "../../../resources/maps/AfricaThumb.webp";
import pangaea from "../../../resources/maps/PangaeaThumb.webp";
import asia from "../../../resources/maps/AsiaThumb.webp";
import mars from "../../../resources/maps/MarsThumb.webp";
import britannia from "../../../resources/maps/BritanniaThumb.webp";
import gatewayToTheAtlantic from "../../../resources/maps/GatewayToTheAtlanticThumb.webp";
import australia from "../../../resources/maps/AustraliaThumb.webp";
import iceland from "../../../resources/maps/IcelandThumb.webp";

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
