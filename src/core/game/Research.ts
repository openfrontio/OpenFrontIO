import { Player, PlayerType, UnitType } from "./Game";

export enum ResearchType {
  PopulationDensity = "population_density",
  PopulationGrowth = "population_growth",
  Economy = "economy",
  Military = "military",
  Scientific = "scientific",
}

export const RESEARCH_TYPES = Object.freeze(Object.values(ResearchType));

export interface ResearchSnapshot {
  levels: Record<ResearchType, number>;
  points: bigint;
}

export const BASE_RESEARCH_COST = 25n;
export const RESEARCH_TICKS_PER_SECOND = 10n;
export const RESEARCH_POINTS_PER_FACILITY_LEVEL_PER_SECOND = 1n;
const BASIS_POINTS = 10_000n;

function emptyResearchLevels(): Record<ResearchType, number> {
  return Object.fromEntries(RESEARCH_TYPES.map((type) => [type, 0])) as Record<
    ResearchType,
    number
  >;
}

export function researchRequirement(base: bigint, level: number): bigint {
  let result = base;
  for (let i = 0; i < level; i++) {
    result = (result * 5n + 3n) / 4n;
  }
  return result;
}

export function researchFirstLevelBasisPoints(type: ResearchType): number {
  return type === ResearchType.PopulationDensity ? 500 : 250;
}

/** Cumulative diminishing bonus, returned in basis points. */
export function researchBonusBasisPoints(
  level: number,
  firstLevelBasisPoints: number,
): number {
  let total = 0;
  for (let i = 0; i < level; i++) {
    total += Math.floor((firstLevelBasisPoints * 100) / (100 + 2 * i));
  }
  return total;
}

export function researchMultiplier(
  level: number,
  firstLevelPercent: number,
): number {
  return 1 + researchBonusBasisPoints(level, firstLevelPercent * 100) / 10_000;
}

export function researchProductionBasisPoints(
  facilityLevels: number,
  scientificLevel: number,
): bigint {
  const scienceBonus = researchBonusBasisPoints(
    scientificLevel,
    researchFirstLevelBasisPoints(ResearchType.Scientific),
  );
  return (
    BigInt(Math.max(0, Math.floor(facilityLevels))) *
    RESEARCH_POINTS_PER_FACILITY_LEVEL_PER_SECOND *
    (BASIS_POINTS + BigInt(scienceBonus))
  );
}

export class PlayerResearch {
  private readonly levelsValue = emptyResearchLevels();
  private pointsValue = 0n;
  private productionRemainder = 0n;
  private cachedSnapshot: ResearchSnapshot | null = null;

  constructor(private readonly player: Player) {}

  level(type: ResearchType): number {
    return this.levelsValue[type];
  }

  points(): bigint {
    return this.pointsValue;
  }

  purchase(type: ResearchType): boolean {
    if (this.player.type() === PlayerType.Bot) return false;
    const cost = researchRequirement(BASE_RESEARCH_COST, this.level(type));
    if (this.pointsValue < cost) return false;
    this.pointsValue -= cost;
    this.levelsValue[type]++;
    this.cachedSnapshot = null;
    return true;
  }

  tick(): void {
    if (!this.player.isAlive() || this.player.type() === PlayerType.Bot) return;

    let facilityLevels = 0;
    for (const facility of this.player.units(UnitType.ResearchFacility)) {
      if (!facility.isUnderConstruction()) facilityLevels += facility.level();
    }

    const numerator =
      researchProductionBasisPoints(
        facilityLevels,
        this.level(ResearchType.Scientific),
      ) + this.productionRemainder;
    const denominator = BASIS_POINTS * RESEARCH_TICKS_PER_SECOND;
    const generated = numerator / denominator;
    const nextRemainder = numerator % denominator;

    if (generated === 0n && nextRemainder === this.productionRemainder) return;
    this.productionRemainder = nextRemainder;
    if (generated > 0n) {
      this.pointsValue += generated;
      this.cachedSnapshot = null;
    }
  }

  snapshot(): ResearchSnapshot {
    if (this.cachedSnapshot !== null) return this.cachedSnapshot;
    this.cachedSnapshot = {
      levels: { ...this.levelsValue },
      points: this.pointsValue,
    };
    return this.cachedSnapshot;
  }

  hash(): number {
    let hash = 0;
    for (let i = 0; i < RESEARCH_TYPES.length; i++) {
      hash += (i + 1) * this.levelsValue[RESEARCH_TYPES[i]] * 1009;
    }
    return (
      hash +
      Number(this.pointsValue % 1_000_003n) * 31 +
      Number(this.productionRemainder % 100_003n) * 37
    );
  }
}
