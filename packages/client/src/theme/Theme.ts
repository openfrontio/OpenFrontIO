import { Colord } from "colord";
import { Team } from "engine/game/Game";
import { GameMap, TileRef } from "engine/game/GameMap";
import { PlayerView } from "client/view";

export interface Theme {
  teamColor(team: Team): Colord;
  // Don't call directly, use PlayerView
  territoryColor(playerInfo: PlayerView): Colord;
  // Don't call directly, use PlayerView
  structureColors(territoryColor: Colord): { light: Colord; dark: Colord };
  // Don't call directly, use PlayerView
  borderColor(territoryColor: Colord): Colord;
  // Don't call directly, use PlayerView
  defendedBorderColors(territoryColor: Colord): { light: Colord; dark: Colord };
  focusedBorderColor(): Colord;
  terrainColor(gm: GameMap, tile: TileRef): Colord;
  backgroundColor(): Colord;
  falloutColor(): Colord;
  font(): string;
  textColor(playerInfo: PlayerView): string;
  spawnHighlightColor(): Colord;
  spawnHighlightSelfColor(): Colord;
  spawnHighlightTeamColor(): Colord;
  spawnHighlightEnemyColor(): Colord;
}
