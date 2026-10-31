/**
 * Public lobby player counts for a map: 50 players per 1,000,000 land tiles,
 * then 75% and 50% of that, all rounded to the nearest 5.
 */
export function mapPlayerCounts(landTiles: number): [number, number, number] {
  const roundToNearest5 = (n: number) => Math.round(n / 5) * 5;

  const base = Math.max(roundToNearest5((landTiles / 1_000_000) * 50), 5);
  return [base, roundToNearest5(base * 0.75), roundToNearest5(base * 0.5)];
}
