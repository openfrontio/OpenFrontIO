import { BoatType, NukeType, OtherUnit } from "../AnalyticsSchemas";
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

  boatSend(player: PlayerID, type: BoatType): void;
  boatArrive(player: PlayerID, type: BoatType): void;
  boatDestroy(player: PlayerID, type: BoatType): void;

  bombLaunch(player: PlayerID, target: PlayerID | null, type: NukeType): void;
  bombLand(player: PlayerID, target: PlayerID | null, type: NukeType): void;
  bombIntercept(player: PlayerID, interceptor: PlayerID, type: NukeType): void;

  goldWork(player: PlayerID, gold: number): void;
  goldTrade(player: PlayerID, other: PlayerID, gold: number): void;
  goldWar(player: PlayerID, captured: PlayerID, gold: number): void;

  unitBuild(player: PlayerID, type: OtherUnit): void;
  unitLose(player: PlayerID, type: OtherUnit): void;
  unitDestroy(player: PlayerID, type: OtherUnit): void;
  unitCapture(player: PlayerID, type: OtherUnit): void;
}
