import { NukeType, PlayerID } from "./Game";

export interface PlayerStats {
  sentNukes: {
    // target
    [key: PlayerID]: {
      [key in NukeType]: number;
    };
  };
}

export interface Stats {
  increaseNukeCount(sender: PlayerID, target: PlayerID, type: NukeType): void;
  getPlayerStats(player: PlayerID): PlayerStats;
}
