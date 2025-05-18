import { NukeType, OtherUnit } from "../AnalyticsSchemas";
import { AllPlayersStats, PlayerStats } from "../Schemas";
import { PlayerID } from "./Game";

export interface Stats {
  getPlayerStats(player: PlayerID): PlayerStats;
  stats(): AllPlayersStats;

  // Player attacks target
  attack(player: PlayerID, target: PlayerID | null, troops: number): void;

  // Player cancels attack on target
  attackCancel(player: PlayerID, target: PlayerID | null, troops: number): void;

  // Player betrays another player
  betray(player: PlayerID): void;

  // Player sends a trade ship to target
  boatSendTrade(player: PlayerID, target: PlayerID): void;

  // Player's trade ship arrives at target, both players earn gold
  boatArriveTrade(player: PlayerID, target: PlayerID, gold: number): void;

  // Player destroys target's trade ship
  boatDestroyTrade(player: PlayerID, target: PlayerID): void;

  // Player sends a transport ship to target with troops
  boatSendTroops(
    player: PlayerID,
    target: PlayerID | null,
    troops: number,
  ): void;

  // Player's transport ship arrives at target with troops
  boatArriveTroops(
    player: PlayerID,
    target: PlayerID | null,
    troops: number,
  ): void;

  // Player destroys target's transport ship with troops
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
