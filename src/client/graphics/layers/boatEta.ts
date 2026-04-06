/** Estimates arrival time in seconds from remaining ticks and server tick interval. */
export function estimateBoatEtaSeconds(
  remainingTicks: number,
  turnIntervalMs: number,
): number {
  if (!Number.isFinite(remainingTicks) || remainingTicks < 0) {
    throw new Error(`Invalid remainingTicks: ${remainingTicks}`);
  }
  if (!Number.isFinite(turnIntervalMs) || turnIntervalMs <= 0) {
    throw new Error(`Invalid turnIntervalMs: ${turnIntervalMs}`);
  }
  const secondsPerTick = turnIntervalMs / 1000;
  return Math.ceil(remainingTicks * secondsPerTick);
}
