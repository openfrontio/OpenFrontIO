/** The simulation runs at 10 ticks per second (Config turnIntervalMs = 100). */
export const TICKS_PER_SECOND = 10;

export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}

/**
 * Ticks left on an alliance request the game made on its tick `createdAt`,
 * seen at the view's tick `now`. The game counts from the tick it last ran,
 * and the view's clock is already one past it. At 0 the request is in its
 * last tick; below 0 the game has let it lapse.
 */
export function requestTicksLeft(
  createdAt: number,
  now: number,
  duration: number,
): number {
  return duration - (now - 1 - createdAt);
}
