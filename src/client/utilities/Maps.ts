import world from "../../../resources/maps/WorldMap.png";
import oceania from "../../../resources/maps/Oceania.png";
import europe from "../../../resources/maps/Europe.png";
import mena from "../../../resources/maps/Mena.png";
import northAmerica from "../../../resources/maps/NorthAmerica.png";
import southAmerica from "../../../resources/maps/SouthAmerica.png";
import blackSea from "../../../resources/maps/BlackSea.png";
import africa from "../../../resources/maps/Africa.png";
import asia from "../../../resources/maps/Asia.png";
import mars from "../../../resources/maps/Mars.png";
import britannia from "../../../resources/maps/Britannia.png";
import gatewayToTheAtlantic from "../../../resources/maps/GatewayToTheAtlantic.png";

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
