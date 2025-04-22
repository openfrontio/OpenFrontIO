export class MultiTabDetector {
  private readonly tabId: string = `${Date.now()}-${Math.random()}`;
  private readonly lockKey = "openfront-tab-lock";
  private readonly heartbeatInterval = 1000;
  private readonly staleThreshold = 3000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private unloadHandler: (() => void) | null = null;
  private isPunished = false;
  private startPenaltyCallback?: (duration: number) => void;
  private numPunishmentsGiven = 0;
  private readonly punishmentDelays: number[] = [
    2000, 3000, 5000, 10000, 30000, 60000,
  ];

  public startMonitoring(startPenalty: (duration: number) => void): void {
    this.startPenaltyCallback = startPenalty;
    this.acquireLock();

    // Store an invisible lock element to track lock status
    this.createInvisibleLockElement();

    this.heartbeatTimer = setInterval(() => {
      const lock = this.readLock();
      if (!lock) {
        this.acquireLock();
        return;
      }

      if (lock.owner === this.tabId || Date.now() - lock.timestamp > this.staleThreshold) {
        this.writeLock();
        this.isPunished = false;
        return;
      }

      if (!this.isPunished) {
        this.applyPunishment();
      }
    }, this.heartbeatInterval);
  }

  public stopMonitoring(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.unloadHandler) {
      window.removeEventListener("beforeunload", this.unloadHandler);
      this.unloadHandler = null;
    }

    const lock = this.readLock();
    if (lock?.owner === this.tabId) {
      localStorage.removeItem(this.lockKey);
    }

    // Remove the invisible lock element
    this.removeInvisibleLockElement();
  }

  private acquireLock(): void {
    this.writeLock();

    this.unloadHandler = () => {
      const lock = this.readLock();
      if (lock?.owner === this.tabId) {
        localStorage.removeItem(this.lockKey);
      }
    };

    window.addEventListener("beforeunload", this.unloadHandler);
  }

  private writeLock(): void {
    localStorage.setItem(
      this.lockKey,
      JSON.stringify({ owner: this.tabId, timestamp: Date.now() }),
    );
  }

  private readLock(): { owner: string; timestamp: number } | null {
    try {
      const raw = localStorage.getItem(this.lockKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private applyPunishment(): void {
    this.isPunished = true;

    const delay =
      this.numPunishmentsGiven >= this.punishmentDelays.length
        ? this.punishmentDelays[this.punishmentDelays.length - 1]
        : this.punishmentDelays[this.numPunishmentsGiven];

    this.numPunishmentsGiven++;

    if (this.startPenaltyCallback) {
      this.startPenaltyCallback(delay);
    }

    setTimeout(() => {
      this.isPunished = false;
    }, delay);
  }

  // Create an invisible lock element in the DOM that cannot be easily removed
  private createInvisibleLockElement(): void {
    if (!document.getElementById("invisible-lock")) {
      const lockElement = document.createElement("div");
      lockElement.id = "invisible-lock";
      lockElement.style.display = "none"; // Hidden but still in the DOM
      document.body.appendChild(lockElement);
    }
  }

  // Remove the invisible lock element from the DOM
  private removeInvisibleLockElement(): void {
    const lockElement = document.getElementById("invisible-lock");
    if (lockElement) {
      lockElement.remove();
    }
  }
}
