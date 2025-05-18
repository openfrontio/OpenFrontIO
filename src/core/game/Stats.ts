import { NukeType, OtherUnit } from "../AnalyticsSchemas";
import { AllPlayersStats, PlayerStats } from "../Schemas";
import { PlayerID } from "./Game";

export interface Stats {
  getPlayerStats(player: PlayerID): PlayerStats;
  stats(): AllPlayersStats;

  attack(player: PlayerID, target: PlayerID | null, troops: number): void;
  attackCancel(player: PlayerID, target: PlayerID | null, troops: number): void;

  betray(player: PlayerID): void;

  boatSendTrade(player: PlayerID, target: PlayerID): void;
  boatArriveTrade(player: PlayerID, target: PlayerID, gold: number): void;
  boatDestroyTrade(player: PlayerID, target: PlayerID): void;

  boatSendTroops(
    player: PlayerID,
    target: PlayerID | null,
    troops: number,
  ): void;
  boatArriveTroops(
    player: PlayerID,
    target: PlayerID | null,
    troops: number,
  ): void;
  boatDestroyTroops(player: PlayerID, target: PlayerID, troops: number): void;

  // Player launches bomb at target
  bombLaunch(player: PlayerID, target: PlayerID | null, type: NukeType): void;

  // Player's bomb lands at target
  bombLand(player: PlayerID, target: PlayerID | null, type: NukeType): void;

  // Player's SAM intercepts a bomb from attacker
  bombIntercept(player: PlayerID, attacker: PlayerID, type: NukeType): void;

  // Player earns gold from conquering tiles or trade ships from captured
  goldWar(player: PlayerID, captured: PlayerID, gold: number): void;

  // Player earns gold from workers
  goldWork(player: PlayerID, gold: number): void;

  // Player builds a unit of type
  unitBuild(player: PlayerID, type: OtherUnit): void;

  // Player captures a unit of type
  unitCapture(player: PlayerID, type: OtherUnit): void;

  // Player destroys a unit of type
  unitDestroy(player: PlayerID, type: OtherUnit): void;

  // Player loses a unit of type
  unitLose(player: PlayerID, type: OtherUnit): void;
}
