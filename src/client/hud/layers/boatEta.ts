/** Estimates arrival time in seconds from remaining ticks and a tick duration in ms. */
export function estimateBoatEtaSeconds(
  remainingTicks: number,
  msPerTick: number,
): number {
  if (!Number.isFinite(remainingTicks) || remainingTicks < 0) {
    throw new Error(`Invalid remainingTicks: ${remainingTicks}`);
  }
  if (!Number.isFinite(msPerTick) || msPerTick <= 0) {
    throw new Error(`Invalid msPerTick: ${msPerTick}`);
  }
  return Math.ceil((remainingTicks * msPerTick) / 1000);
}
