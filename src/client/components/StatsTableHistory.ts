// What the leaderboard table keeps from one refresh to the next.

/**
 * Whether the list a refresh draws follows on from the last refresh's: the
 * same sort, and a clock that went on by no more than a jump. When it does
 * not (a new sort, a replay seek, a tab that slept), what the table kept of
 * the last refresh says nothing about what changed since.
 */
export class RefreshClock {
  private last: { sort: string; tick: number; speed: number } | null = null;
  private readonly jumpTicks: number;

  /** `jumpTicks`: the longest gap between two refreshes at normal speed. */
  constructor(jumpTicks: number) {
    this.jumpTicks = jumpTicks;
  }

  /**
   * Notes a refresh of the list sorted by `sort` at `tick`. A game playing
   * `speed` times faster (a replay) puts that many times more ticks between
   * two refreshes. The gap may have built up at the last refresh's speed,
   * when the viewer slows a replay in between, so the faster one counts.
   */
  next(sort: string, tick: number, speed: number): boolean {
    const last = this.last;
    this.last = { sort, tick, speed };
    return (
      last !== null &&
      last.sort === sort &&
      tick >= last.tick &&
      tick - last.tick <= this.jumpTicks * Math.max(speed, last.speed)
    );
  }
}
