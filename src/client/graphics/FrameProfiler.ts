export class FrameProfiler {
  private static timings: Record<string, number> = {};
  private static enabled: boolean = false;

  /**
   * Enable or disable profiling.
   */
  static setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if profiling is enabled.
   */
  static isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Clear all accumulated timings for the current frame.
   */
  static clear(): void {
    if (!this.enabled) return;
    this.timings = {};
  }

  /**
   * Record a duration (in ms) for a named span.
   */
  static record(name: string, duration: number): void {
    if (!this.enabled || !Number.isFinite(duration)) return;
    this.timings[name] = (this.timings[name] ?? 0) + duration;
  }

  /**
   * Convenience helper to start a span.
   * Returns a high-resolution timestamp to be passed into end().
   */
  static start(): number {
    if (!this.enabled) return 0;
    return performance.now();
  }

  /**
   * Convenience helper to end a span started with start().
   */
  static end(name: string, startTime: number): void {
    if (!this.enabled || startTime === 0) return;
    const duration = performance.now() - startTime;
    this.record(name, duration);
  }

  /**
   * Consume and reset all timings collected so far.
   */
  static consume(): Record<string, number> {
    if (!this.enabled) return {};
    const copy = { ...this.timings };
    this.timings = {};
    return copy;
  }
}
