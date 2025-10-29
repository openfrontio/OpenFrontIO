import { Game, Player, Relation, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { closestTile } from "../Util";

type ClusterPreference = Readonly<{
  near: number;
  ideal: number;
  far: number;
  weight: number;
}>;

const assertPreference = (pref: ClusterPreference): ClusterPreference => {
  if (!(pref.near <= pref.ideal && pref.ideal <= pref.far) || pref.weight < 0) {
    throw new Error("Invalid ClusterPreference");
  }
  return pref;
};

function complementaryPlacementScore(
  mg: Game,
  tile: TileRef,
  targets: Set<TileRef>,
  pref: ClusterPreference,
): number {
  if (targets.size === 0) return 0;
  const [, distance] = closestTile(mg, targets, tile);
  if (!Number.isFinite(distance)) return 0;

  if (distance < pref.near) {
    const penalty = (pref.near - distance) / Math.max(pref.near, 1);
    return -penalty * pref.weight * 0.5;
  }
  if (distance > pref.far) {
    return 0;
  }
  const span = pref.far - pref.near;
  if (span <= 0) {
    return 0;
  }

  const normalized = 1 - Math.abs(distance - pref.ideal) / Math.max(span, 1);
  return Math.max(0, normalized) * pref.weight;
}

export function structureSpawnTileValue(
  mg: Game,
  player: Player,
  type: UnitType,
): (tile: TileRef) => number {
  const borderTiles = player.borderTiles();
  const otherUnits = player.units(type);
  // Prefer spacing structures out of atom bomb range
  const borderSpacing = mg.config().nukeMagnitudes(UnitType.AtomBomb).outer;
  const structureSpacing = borderSpacing * 2;
  const cityTiles: Set<TileRef> = new Set(
    player.units(UnitType.City).map((u) => u.tile()),
  );
  const factoryTiles: Set<TileRef> = new Set(
    player.units(UnitType.Factory).map((u) => u.tile()),
  );
  const portTiles: Set<TileRef> = new Set(
    player.units(UnitType.Port).map((u) => u.tile()),
  );
  const clusterTiles: Set<TileRef> = new Set([
    ...cityTiles,
    ...factoryTiles,
    ...portTiles,
  ]);
  const missileSiloTiles: Set<TileRef> = new Set(
    player.units(UnitType.MissileSilo).map((u) => u.tile()),
  );

  switch (type) {
    case UnitType.City:
    case UnitType.Factory: {
      return (tile) => {
        let w = 0;

        // Prefer higher elevations
        w += mg.magnitude(tile);

        // Prefer to be away from the border
        const [, closestBorderDist] = closestTile(mg, borderTiles, tile);
        w += Math.min(closestBorderDist, borderSpacing);

        // Prefer to be away from other structures of the same type
        const otherTiles: Set<TileRef> = new Set(
          otherUnits.map((u) => u.tile()),
        );
        otherTiles.delete(tile);
        const [, d] = closestTile(mg, otherTiles, tile);
        if (Number.isFinite(d)) {
          w += Math.min(d, structureSpacing);
        }

        const complementaryPreferences: Array<
          [Set<TileRef>, ClusterPreference]
        > =
          type === UnitType.City
            ? [
                [
                  portTiles,
                  assertPreference({
                    near: 12,
                    ideal: 60,
                    far: 150,
                    weight: structureSpacing,
                  }),
                ],
                [
                  factoryTiles,
                  assertPreference({
                    near: 10,
                    ideal: 55,
                    far: 130,
                    weight: structureSpacing * 0.9,
                  }),
                ],
              ]
            : [
                [
                  cityTiles,
                  assertPreference({
                    near: 8,
                    ideal: 50,
                    far: 120,
                    weight: structureSpacing * 0.85,
                  }),
                ],
                [
                  portTiles,
                  assertPreference({
                    near: 14,
                    ideal: 65,
                    far: 160,
                    weight: structureSpacing * 0.6,
                  }),
                ],
              ];

        for (const [targets, pref] of complementaryPreferences) {
          const bonus = complementaryPlacementScore(mg, tile, targets, pref);
          w += bonus;
        }

        // TODO: Cities and factories should consider train range limits
        return w;
      };
    }
    case UnitType.MissileSilo: {
      return (tile) => {
        let w = 0;

        // Favor stable ground and spacing from the front line
        w += mg.magnitude(tile) * 1.25;
        const [, closestBorderDist] = closestTile(mg, borderTiles, tile);
        w += Math.min(closestBorderDist, borderSpacing * 1.5);

        // Avoid clustering missile silos together
        const otherTiles: Set<TileRef> = new Set(
          otherUnits.map((u) => u.tile()),
        );
        otherTiles.delete(tile);
        const [, siloSpacing] = closestTile(mg, otherTiles, tile);
        if (Number.isFinite(siloSpacing)) {
          w += Math.min(siloSpacing, structureSpacing * 1.5);
        }

        // Keep missile silos offset from economic clusters
        const spacingReference = Math.max(borderSpacing, 25);
        const missileClusterPreference = assertPreference({
          near: spacingReference,
          ideal: spacingReference * 2,
          far: spacingReference * 4,
          weight: structureSpacing,
        });
        w += complementaryPlacementScore(
          mg,
          tile,
          clusterTiles,
          missileClusterPreference,
        );

        return w;
      };
    }
    case UnitType.Port: {
      return (tile) => {
        let w = 0;

        // Prefer to be away from other structures of the same type
        const otherTiles: Set<TileRef> = new Set(
          otherUnits.map((u) => u.tile()),
        );
        otherTiles.delete(tile);
        const [, closestOtherDist] = closestTile(mg, otherTiles, tile);
        w += Math.min(closestOtherDist, structureSpacing);

        const complementaryPreferences: Array<
          [Set<TileRef>, ClusterPreference]
        > = [
          [
            cityTiles,
            assertPreference({
              near: 12,
              ideal: 55,
              far: 160,
              weight: structureSpacing,
            }),
          ],
          [
            factoryTiles,
            assertPreference({
              near: 16,
              ideal: 70,
              far: 170,
              weight: structureSpacing * 0.8,
            }),
          ],
        ];

        for (const [targets, pref] of complementaryPreferences) {
          const bonus = complementaryPlacementScore(mg, tile, targets, pref);
          w += bonus;
        }

        return w;
      };
    }
    case UnitType.DefensePost: {
      return (tile) => {
        let w = 0;

        // Prefer higher elevations
        w += mg.magnitude(tile);

        const [closest, closestBorderDist] = closestTile(mg, borderTiles, tile);
        if (closest !== null) {
          // Prefer to be borderSpacing tiles from the border
          w += Math.max(
            0,
            borderSpacing - Math.abs(borderSpacing - closestBorderDist),
          );

          // Prefer adjacent players who are hostile
          const neighbors: Set<Player> = new Set();
          for (const tile of mg.neighbors(closest)) {
            if (!mg.isLand(tile)) continue;
            const id = mg.ownerID(tile);
            if (id === player.smallID()) continue;
            const neighbor = mg.playerBySmallID(id);
            if (!neighbor.isPlayer()) continue;
            neighbors.add(neighbor);
          }
          for (const neighbor of neighbors) {
            w +=
              borderSpacing * (Relation.Friendly - player.relation(neighbor));
          }
        }

        // Prefer to be away from other structures of the same type
        const otherTiles: Set<TileRef> = new Set(
          otherUnits.map((u) => u.tile()),
        );
        otherTiles.delete(tile);
        const [, d] = closestTile(mg, otherTiles, tile);
        if (Number.isFinite(d)) {
          w += Math.min(d, structureSpacing);
        }

        return w;
      };
    }
    case UnitType.SAMLauncher: {
      const protectTiles: Set<TileRef> = new Set();
      for (const unit of player.units()) {
        switch (unit.type()) {
          case UnitType.City:
          case UnitType.Factory:
          case UnitType.MissileSilo:
          case UnitType.Port:
            protectTiles.add(unit.tile());
        }
      }
      const range = mg.config().defaultSamRange();
      const rangeSquared = range * range;
      return (tile) => {
        let w = 0;

        // Prefer higher elevations
        w += mg.magnitude(tile);

        // Prefer to be away from the border
        const [, borderDist] = closestTile(mg, borderTiles, tile);
        if (Number.isFinite(borderDist)) {
          w += Math.min(borderDist, borderSpacing);
        }

        // Prefer to be away from other structures of the same type
        const otherTiles: Set<TileRef> = new Set(
          otherUnits.map((u) => u.tile()),
        );
        otherTiles.delete(tile);
        const [, d] = closestTile(mg, otherTiles, tile);
        if (Number.isFinite(d)) {
          w += Math.min(d, structureSpacing);
        }

        const samIdeal = Math.max(18, Math.floor((range * 5) / 10));
        const samPreference: ClusterPreference = {
          near: 8,
          ideal: samIdeal,
          far: Math.max(samIdeal + 20, range),
          weight: structureSpacing,
        };
        w += complementaryPlacementScore(mg, tile, clusterTiles, samPreference);

        if (missileSiloTiles.size > 0) {
          const missileGuardPreference: ClusterPreference = {
            near: 12,
            ideal: Math.max(25, Math.floor((range * 3) / 10)),
            far: Math.max(range, samIdeal),
            weight: structureSpacing * 0.9,
          };
          w += complementaryPlacementScore(
            mg,
            tile,
            missileSiloTiles,
            missileGuardPreference,
          );
        }

        // Prefer to be in range of other structures
        let coversEconomicCluster = false;
        let coversMissileSilo = false;
        for (const maybeProtected of protectTiles) {
          const distanceSquared = mg.euclideanDistSquared(tile, maybeProtected);
          if (distanceSquared > rangeSquared) continue;
          w += structureSpacing;
          if (clusterTiles.has(maybeProtected)) {
            coversEconomicCluster = true;
          }
          if (missileSiloTiles.has(maybeProtected)) {
            coversMissileSilo = true;
          }
        }

        if (clusterTiles.size > 0 && !coversEconomicCluster) {
          w -= structureSpacing * 0.8;
        }
        if (missileSiloTiles.size > 0 && !coversMissileSilo) {
          w -= structureSpacing * 0.6;
        }

        return w;
      };
    }
    default:
      throw new Error(`Value function not implemented for ${type}`);
  }
}
