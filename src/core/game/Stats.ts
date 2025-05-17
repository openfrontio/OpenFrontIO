import { NukeType, OtherUnit } from "../AnalyticsSchemas";
import { AllPlayersStats, PlayerStats } from "../Schemas";
import { PlayerID } from "./Game";

export interface Stats {
  getPlayerStats(player: PlayerID): PlayerStats;
  stats(): AllPlayersStats;

  attack(outgoing: PlayerID, incoming: PlayerID | null, troops: number): void;
  attackCancel(
    outgoing: PlayerID,
    incoming: PlayerID | null,
    troops: number,
  ): void;

  betray(betraor: PlayerID): void;

  boatSendTrade(player: PlayerID, target: PlayerID): void;
  boatArriveTrade(player: PlayerID, target: PlayerID, gold: number): void;
  boatDestroyTrade(player: PlayerID, target: PlayerID, gold: number): void;

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

  bombLaunch(player: PlayerID, target: PlayerID | null, type: NukeType): void;
  bombLand(player: PlayerID, target: PlayerID | null, type: NukeType): void;
  bombIntercept(player: PlayerID, interceptor: PlayerID, type: NukeType): void;

  goldWork(player: PlayerID, gold: number): void;
  goldWar(player: PlayerID, captured: PlayerID, gold: number): void;

  unitBuild(player: PlayerID, type: OtherUnit): void;
  unitLose(player: PlayerID, type: OtherUnit): void;
  unitDestroy(player: PlayerID, type: OtherUnit): void;
  unitCapture(player: PlayerID, type: OtherUnit): void;
}
