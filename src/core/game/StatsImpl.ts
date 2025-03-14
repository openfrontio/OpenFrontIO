import { AllPlayersStats, PlayerStats } from "../Schemas";
import { NukeType, PlayerID, UnitType } from "./Game";
import { Stats } from "./Stats";

export class StatsImpl implements Stats {
  data: AllPlayersStats = {};

  _createUserData(sender: PlayerID, target: PlayerID): void {
    if (!this.data[sender]) {
      this.data[sender] = { sentNukes: {} };
    }
    if (!this.data[sender].sentNukes[target]) {
      this.data[sender].sentNukes[target] = {
        [UnitType.MIRV]: 0,
        [UnitType.MIRVWarhead]: 0,
        [UnitType.AtomBomb]: 0,
        [UnitType.HydrogenBomb]: 0,
      };
    }
  }

  increaseNukeCount(sender: PlayerID, target: PlayerID, type: NukeType): void {
    this._createUserData(sender, target);
    this.data[sender].sentNukes[target][type]++;
  }

  getPlayerStats(player: PlayerID): PlayerStats {
    return this.data[player];
  }

  stats() {
    return this.data;
  }
}
