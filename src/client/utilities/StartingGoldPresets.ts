export const STARTING_GOLD_PRESETS = [
  0, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000, 3_000_000,
  4_000_000, 5_000_000, 6_000_000, 7_000_000, 8_000_000, 9_000_000, 10_000_000,
] as const;

export function startingGoldValueFromIndex(index: number): number {
  const clampedIndex = Math.max(
    0,
    Math.min(index, STARTING_GOLD_PRESETS.length - 1),
  );
  return STARTING_GOLD_PRESETS[clampedIndex];
}

export function startingGoldIndexFromValue(value: number): number {
  const normalizedValue = Math.max(
    0,
    Math.min(value, STARTING_GOLD_PRESETS[STARTING_GOLD_PRESETS.length - 1]),
  );
  let closestIndex = 0;
  let smallestDelta = Number.POSITIVE_INFINITY;

  STARTING_GOLD_PRESETS.forEach((preset, index) => {
    const delta = Math.abs(preset - normalizedValue);
    if (delta < smallestDelta) {
      smallestDelta = delta;
      closestIndex = index;
    }
  });

  return closestIndex;
}
