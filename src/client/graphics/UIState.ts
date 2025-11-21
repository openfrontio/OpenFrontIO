import { UnitType } from "../../core/game/Game";
import { PingType } from "../../core/game/Ping";

export interface UIState {
  attackRatio: number;
  ghostStructure: UnitType | null;
  currentPingType: PingType | null;
}
