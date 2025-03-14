import { AllPlayersStats, PlayerStats } from "../Schemas";
import { NukeType, PlayerID } from "./Game";

export interface Stats {
  increaseNukeCount(sender: PlayerID, target: PlayerID, type: NukeType): void;
  getPlayerStats(player: PlayerID): PlayerStats;
  stats(): AllPlayersStats;
}
