export class FrameProfiler {
  private static timings: Record<string, number> = {};

  /**
   * Clear all accumulated timings for the current frame.
   */
  static clear(): void {
    this.timings = {};
  }

  /**
   * Record a duration (in ms) for a named span.
   */
  static record(name: string, duration: number): void {
    if (!Number.isFinite(duration)) return;
    this.timings[name] = (this.timings[name] ?? 0) + duration;
  }

  /**
   * Convenience helper to start a span.
   * Returns a high-resolution timestamp to be passed into end().
   */
  static start(): number {
    return performance.now();
  }

  /**
   * Convenience helper to end a span started with start().
   */
  static end(name: string, startTime: number): void {
    const duration = performance.now() - startTime;
    this.record(name, duration);
  }

  /**
   * Consume and reset all timings collected so far.
   */
  static consume(): Record<string, number> {
    const copy = { ...this.timings };
    this.timings = {};
    return copy;
  }
}
