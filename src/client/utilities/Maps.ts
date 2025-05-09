import africa from "../../../resources/maps/AfricaThumb.webp";
import asia from "../../../resources/maps/AsiaThumb.webp";
import australia from "../../../resources/maps/AustraliaThumb.webp";
import betweenTwoSeas from "../../../resources/maps/BetweenTwoSeasThumb.webp";
import blackSea from "../../../resources/maps/BlackSeaThumb.webp";
import britannia from "../../../resources/maps/BritanniaThumb.webp";
import deglaciatedAntarctica from "../../../resources/maps/DeglaciatedAntarcticaThumb.webp";
import europeClassic from "../../../resources/maps/EuropeClassicThumb.webp";
import europe from "../../../resources/maps/EuropeThumb.webp";
import falklandislands from "../../../resources/maps/FalklandIslandsThumb.webp";
import faroeislands from "../../../resources/maps/FaroeIslandsThumb.webp";
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
    case GameMapType.EuropeClassic:
      return europeClassic;
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
    case GameMapType.BetweenTwoSeas:
      return betweenTwoSeas;
    case GameMapType.KnownWorld:
      return knownworld;
    case GameMapType.FaroeIslands:
      return faroeislands;
    case GameMapType.DeglaciatedAntarctica:
      return deglaciatedAntarctica;
    case GameMapType.FalklandIslands:
      return falklandislands;
    default:
      return "";
  }
}
