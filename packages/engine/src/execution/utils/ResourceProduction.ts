import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { Player } from "../../game/Game";

export const RESOURCE_PRODUCTION_UNIT_TYPES = [
  UnitType.OilMine,
  UnitType.GoldMine,
  UnitType.DiamondMine,
  UnitType.LivestockFarm,
] as const;

/**
 * A successful normal trade shipment adds a bounded amount of production
 * capacity to every resource structure owned by the port owner. It never
 * resets a structure to a full reserve.
 */
export function refillResourceProduction(
  player: Player,
  game: Parameters<Player["buildUnit"]>[0],
): void {
  for (const unit of player.units(RESOURCE_PRODUCTION_UNIT_TYPES)) {
    if (
      !unit.isActive() ||
      unit.isUnderConstruction() ||
      unit.isMarkedForDeletion()
    ) {
      continue;
    }
    const refill = game.config().resourceProductionTradeRefill(
      unit.type(),
      unit.level(),
      player,
    );
    unit.refillResourceGoldProduced(refill);
  }
}
