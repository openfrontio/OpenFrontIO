import type { Config } from "../configuration/Config";
import { UnitType, type Unit } from "./Game";

type FuelStatUnit = {
  type(): UnitType;
  level(): number;
  fuel(): number;
};

export function isFuelConsumer(type: UnitType): boolean {
  return (
    type === UnitType.City ||
    type === UnitType.Port ||
    type === UnitType.Factory ||
    type === UnitType.MissileSilo
  );
}

export function fuelCapacity(config: Config, unit: FuelStatUnit): number {
  if (!isFuelConsumer(unit.type())) {
    return 0;
  }
  return config.fuelStoragePerStructureLevel() * Math.max(1, unit.level());
}

export function consumeFuel(config: Config, unit: Unit): void {
  if (!isFuelConsumer(unit.type()) || unit.isUnderConstruction()) {
    return;
  }

  const ticksPerSecond = fuelTicksPerSecond(config);
  unit.removeFuel(
    (config.fuelConsumptionPerSecondPerLevel() * Math.max(1, unit.level())) /
      ticksPerSecond,
  );

  if (unit.fuel() > 0) {
    console.log(
      `Unit ${unit.id()} has ${unit.fuel()} fuel and is now inactive.`,
    );
  }
}

function fuelTicksPerSecond(config: Config): number {
  try {
    return Math.max(1, 1000 / config.serverConfig().turnIntervalMs());
  } catch {
    return 10;
  }
}

export function fuelBonus(config: Config, unit: FuelStatUnit): number {
  const capacity = fuelCapacity(config, unit);
  if (capacity <= 0) {
    return 0;
  }

  const fillRatio = Math.max(0, Math.min(1, unit.fuel() / capacity));
  const saturation = Math.max(0.001, config.fuelBonusSaturation());
  const diminishingRatio =
    (1 - Math.exp(-saturation * fillRatio)) / (1 - Math.exp(-saturation));
  return config.fueledStructureMaxBonus() * diminishingRatio;
}
