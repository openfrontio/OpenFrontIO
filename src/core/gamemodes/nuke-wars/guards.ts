/* Guards/helpers for Nuke Wars. */
import {
  GameConfig,
  GameMapType,
  GameMode,
  TeamGameType,
} from "../../game/Game";
import { normalizePrepSeconds } from "./config";

export function isNukeWars(cfg: GameConfig): boolean {
  return (
    cfg.gameMode === GameMode.Team && cfg.teamGameType === TeamGameType.NukeWars
  );
}

export function isNukeWarsOnBaikal(cfg: GameConfig): boolean {
  return isNukeWars(cfg) && cfg.gameMap === GameMapType.Baikal;
}

export function getPreparationTimeSeconds(cfg: GameConfig): number {
  // @ts-expect-error: preparationTimeSeconds is an extension on GameConfig; fallback to default range
  const raw = (cfg as any).preparationTimeSeconds as number | undefined;
  return normalizePrepSeconds(raw);
}
