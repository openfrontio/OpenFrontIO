export class MultiTabDetector {
  private focusChanges: number[] = [];
  private readonly maxFocusChanges: number = 10;
  private readonly timeWindow: number = 60_000;
  private readonly punishmentDelays: number[] = [
    2_000, 3_000, 5_000, 10_000, 30_000, 60_000,
  ];
  private lastFocusChangeTime: number = 0;
  private isPunished: boolean = false;
  private isMonitoring: boolean = false;
  private startPenaltyCallback?: (duration: number) => void;

  private numPunishmentsGiven = 0;

  /**
   * Start monitoring for multi-tabbing behavior
   *
   * @param startPenalty Callback function when punishment starts
   */
  public startMonitoring(startPenalty: (duration: number) => void): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.startPenaltyCallback = startPenalty;

    // Event listeners for window focus/blur
    window.addEventListener("blur", this.handleFocusChange.bind(this));
    window.addEventListener("focus", this.handleFocusChange.bind(this));

    // Also track visibility changes for tab switching
    document.addEventListener(
      "visibilitychange",
      this.handleVisibilityChange.bind(this),
    );
  }

  public stopMonitoring(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;

    // Remove event listeners
    window.removeEventListener("blur", this.handleFocusChange.bind(this));
    window.removeEventListener("focus", this.handleFocusChange.bind(this));
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange.bind(this),
    );

    // Clear data
    this.focusChanges = [];
    this.isPunished = false;
  }

  private handleFocusChange(): void {
    const currentTime = Date.now();

    this.recordFocusChange(currentTime);

    // Check for multi-tabbing when focus is gained
    if (document.hasFocus() && !this.isPunished) {
      this.checkForMultiTabbing(currentTime);
    }
  }

  private handleVisibilityChange(): void {
    const currentTime = Date.now();

    // Record and check regardless of current focus state
    this.recordFocusChange(currentTime);

    // Only check when tab becomes visible
    if (document.visibilityState === "visible" && !this.isPunished) {
      this.checkForMultiTabbing(currentTime);
    }
  }

  private recordFocusChange(timestamp: number): void {
    if (Math.abs(this.lastFocusChangeTime - timestamp) < 100) {
      // Don't count multiple triggers at same time
      return;
    }
    this.focusChanges.push(timestamp);
    console.log(`pushing focus change at ${timestamp}`);
    this.lastFocusChangeTime = timestamp;

    // Keep only recent changes
    if (this.focusChanges.length > this.maxFocusChanges) {
      this.focusChanges.shift();
    }
  }

  private checkForMultiTabbing(currentTime: number): void {
    // Only if we have enough data points
    if (this.focusChanges.length >= this.maxFocusChanges) {
      const oldestChange = this.focusChanges[0];
      const timeSpan = currentTime - oldestChange;

      // If changes happened within detection window
      if (timeSpan <= this.timeWindow) {
        this.applyPunishment();
      }
    }
  }

  private applyPunishment(): void {
    // Prevent multiple punishments
    if (this.isPunished) return;
    this.isPunished = true;

    let punishmentDelay = 0;
    if (this.numPunishmentsGiven >= this.punishmentDelays.length) {
      punishmentDelay = this.punishmentDelays[this.punishmentDelays.length - 1];
    } else {
      punishmentDelay = this.punishmentDelays[this.numPunishmentsGiven];
    }

    this.numPunishmentsGiven++;

    // Call the start penalty callback
    if (this.startPenaltyCallback) {
      this.startPenaltyCallback(punishmentDelay);
    }

    // Remove penalty after delay
    setTimeout(() => {
      this.isPunished = false;
    }, punishmentDelay);
  }
}
