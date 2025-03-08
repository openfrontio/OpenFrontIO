import africa from "@openfrontio/core/resources/maps/Africa.png";
import asia from "@openfrontio/core/resources/maps/Asia.png";
import blackSea from "@openfrontio/core/resources/maps/BlackSea.png";
import europe from "@openfrontio/core/resources/maps/Europe.png";
import mars from "@openfrontio/core/resources/maps/Mars.png";
import mena from "@openfrontio/core/resources/maps/Mena.png";
import northAmerica from "@openfrontio/core/resources/maps/NorthAmerica.png";
import oceania from "@openfrontio/core/resources/maps/Oceania.png";
import world from "@openfrontio/core/resources/maps/WorldMap.png";

import { GameMapType } from "@openfrontio/core/src/game/Game";

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
    case GameMapType.BlackSea:
      return blackSea;
    case GameMapType.Africa:
      return africa;
    case GameMapType.Asia:
      return asia;
    case GameMapType.Mars:
      return mars;
    default:
      return "";
  }
}
