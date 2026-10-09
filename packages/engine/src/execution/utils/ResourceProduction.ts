import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { Player } from "../../game/Game";

export const RESOURCE_PRODUCTION_UNIT_TYPES = [
  UnitType.OilMine,
  UnitType.GoldMine,
  UnitType.DiamondMine,
  UnitType.LivestockFarm,
] as const;

/**
 * A successful trade shipment refreshes the production reserves of every
 * resource structure owned by the two ports involved in that shipment.
 */
export function resetResourceProduction(player: Player): void {
  for (const unit of player.units(RESOURCE_PRODUCTION_UNIT_TYPES)) {
    unit.resetResourceGoldProduced();
  }
}
