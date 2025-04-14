import { AllPlayersStats, PlayerStats } from "../Schemas";
import { NukeType, PlayerID } from "./Game";

export interface Stats {
  increaseNukeCount(
    sender: PlayerID,
    target: PlayerID | null,
    type: NukeType,
  ): void;
  increaseBetrayalCount(player: PlayerID): void;
  getPlayerStats(player: PlayerID): PlayerStats;
  stats(): AllPlayersStats;
}
