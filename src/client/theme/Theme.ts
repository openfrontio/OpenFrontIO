import { Colord } from "colord";
import { Team } from "../../core/game/Game";
import { GameMap, TileRef } from "../../core/game/GameMap";
import { PlayerView } from "../../core/game/GameView";

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
