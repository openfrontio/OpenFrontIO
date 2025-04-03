import africa from "../../../resources/maps/AfricaThumb.webp";
import asia from "../../../resources/maps/AsiaThumb.webp";
import australia from "../../../resources/maps/AustraliaThumb.webp";
import blackSea from "../../../resources/maps/BlackSeaThumb.webp";
import britannia from "../../../resources/maps/BritanniaThumb.webp";
import europe from "../../../resources/maps/EuropeThumb.webp";
import gatewayToTheAtlantic from "../../../resources/maps/GatewayToTheAtlanticThumb.webp";
import iceland from "../../../resources/maps/IcelandThumb.webp";
import japan from "../../../resources/maps/JapanThumb.webp";
import knownworld from "../../../resources/maps/KnownWorldThumb.webp";
import mars from "../../../resources/maps/MarsThumb.webp";
import mena from "../../../resources/maps/MenaThumb.webp";
import northAmerica from "../../../resources/maps/NorthAmericaThumb.webp";
import oceania from "../../../resources/maps/OceaniaThumb.webp";
import pangaea from "../../../resources/maps/PangaeaThumb.webp";
import southAmerica from "../../../resources/maps/SouthAmericaThumb.webp";
import twoSeas from "../../../resources/maps/TwoSeasThumb.webp";
import world from "../../../resources/maps/WorldMapThumb.webp";

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
    case GameMapType.Japan:
      return japan;
    case GameMapType.TwoSeas:
      return twoSeas;
    case GameMapType.KnownWorld:
      return knownworld;
    default:
      return "";
  }
}
