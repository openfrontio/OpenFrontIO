import { TileRef } from "@openfront/engine-api/game/GameMap";
import { AirUnits, UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game, Player, Unit } from "../../game/Game";

/**
 * Moves an aircraft up to `steps` tiles toward `to` in a straight (8-way)
 * line. Stateless and integer-only, so it needs no pathfinder snapshot.
 * Returns true once the aircraft is on `to`.
 */
export function flyToward(
  mg: Game,
  unit: Unit,
  to: TileRef,
  steps: number,
): boolean {
  let x = mg.x(unit.tile());
  let y = mg.y(unit.tile());
  const tx = mg.x(to);
  const ty = mg.y(to);
  for (let i = 0; i < steps; i++) {
    if (x === tx && y === ty) break;
    x += Math.sign(tx - x);
    y += Math.sign(ty - y);
  }
  const next = mg.ref(x, y);
  if (next !== unit.tile()) {
    unit.move(next);
  }
  return x === tx && y === ty;
}

/** Chebyshev distance: the number of flyToward steps between two tiles. */
export function flightDistance(mg: Game, a: TileRef, b: TileRef): number {
  return Math.max(Math.abs(mg.x(a) - mg.x(b)), Math.abs(mg.y(a) - mg.y(b)));
}

/** Whether `unit` belongs to someone `player` may shoot at. */
export function isHostileAircraft(player: Player, unit: Unit): boolean {
  return (
    unit.isActive() &&
    AirUnits.has(unit.type()) &&
    unit.owner() !== player &&
    !player.isFriendly(unit.owner(), true)
  );
}

/** Fighters a base keeps on patrol: half its slots, at least one. */
export function fighterQuota(player: Player, base: Unit): number {
  return Math.max(1, Math.floor(player.airCapacity(base) / 2));
}

/** Fighters currently assigned to `base`. */
export function fightersAt(player: Player, base: Unit): number {
  let n = 0;
  for (const u of player.units(UnitType.Fighter)) {
    if (u.isActive() && u.targetUnit() === base) n++;
  }
  return n;
}
