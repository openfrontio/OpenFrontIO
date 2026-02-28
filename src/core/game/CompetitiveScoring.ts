import { Team } from "./Game";

export interface TeamRawMetrics {
  team: Team;
  peakTilePercentage: number;
  crownRatio: number;
  placementRank: number;
}

export interface TeamScoreBreakdown {
  team: Team;
  maxTilesRank: number;
  maxTilesPoints: number;
  crownTimeRank: number;
  crownTimePoints: number;
  placementRank: number;
  placementPoints: number;
  totalScore: number;
}

function assignRanksDescending(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => b.v - a.v);

  const ranks = new Array<number>(values.length);
  let rank = 1;
  for (let i = 0; i < indexed.length; i++) {
    if (i > 0 && indexed[i].v < indexed[i - 1].v) {
      rank = i + 1;
    }
    ranks[indexed[i].i] = rank;
  }
  return ranks;
}

function pointsForRank(rank: number, table: number[]): number {
  if (rank < 1 || rank > table.length) return 0;
  return table[rank - 1];
}

export function computeCompetitiveScores(
  metrics: TeamRawMetrics[],
): TeamScoreBreakdown[] {
  const maxTilesPointsTable = [60, 54, 48, 42, 36, 30, 24, 18, 12, 6];
  const crownTimePointsTable = [30, 27, 24, 21, 18, 15, 12, 9, 6, 3];
  const placementPointsTable = [10, 8, 6, 4, 2];

  const maxTilesRanks = assignRanksDescending(
    metrics.map((m) => m.peakTilePercentage),
  );
  const crownTimeRanks = assignRanksDescending(
    metrics.map((m) => m.crownRatio),
  );
  // Placement rank: higher placementRank = survived longer = better
  const placementRanks = assignRanksDescending(
    metrics.map((m) => m.placementRank),
  );

  return metrics
    .map((m, i) => {
      const maxTilesRank = maxTilesRanks[i];
      const crownTimeRank = crownTimeRanks[i];
      const placementRank = placementRanks[i];
      const maxTilesPoints = pointsForRank(maxTilesRank, maxTilesPointsTable);
      const crownTimePoints = pointsForRank(
        crownTimeRank,
        crownTimePointsTable,
      );
      const placementPoints = pointsForRank(
        placementRank,
        placementPointsTable,
      );
      return {
        team: m.team,
        maxTilesRank,
        maxTilesPoints,
        crownTimeRank,
        crownTimePoints,
        placementRank,
        placementPoints,
        totalScore: maxTilesPoints + crownTimePoints + placementPoints,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore);
}
