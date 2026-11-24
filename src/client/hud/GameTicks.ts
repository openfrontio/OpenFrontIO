/** The simulation runs at 10 ticks per second (Config turnIntervalMs = 100). */
export const TICKS_PER_SECOND = 10;

export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}
