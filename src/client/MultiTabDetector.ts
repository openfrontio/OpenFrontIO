export class MultiTabDetector {
  private readonly lockKey: string = "openfront_tab_lock";
  private readonly lockTimeout: number = 3000; 
  private readonly heartbeatInterval: number = 1000; 
  private tabId: string = crypto.randomUUID();
  private lockIntervalId: number | null = null;

  private readonly punishmentDelays: number[] = [
    5000, 6000, 7000, 10000, 30000, 60000,
  ];
  private isPunished: boolean = false;
  private isMonitoring: boolean = false;
  private startPenaltyCallback?: (duration: number) => void;
  private numPunishmentsGiven = 0;

  public startMonitoring(startPenalty: (duration: number) => void): void {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    this.startPenaltyCallback = startPenalty;

    this.claimLock();
    this.lockIntervalId = window.setInterval(() => this.heartbeat(), this.heartbeatInterval);

    window.addEventListener("beforeunload", this.releaseLock);
    window.addEventListener("unload", this.releaseLock);
    window.addEventListener("storage", this.handleStorageChange);
  }

  public stopMonitoring(): void {
    if (!this.isMonitoring) return;
    this.isMonitoring = false;

    if (this.lockIntervalId !== null) {
      clearInterval(this.lockIntervalId);
    }

    this.releaseLock();

    window.removeEventListener("beforeunload", this.releaseLock);
    window.removeEventListener("unload", this.releaseLock);
    window.removeEventListener("storage", this.handleStorageChange);
  }

  private claimLock(): void {
    const lock = this.readLock();
    const now = Date.now();

    if (!lock || now - lock.timestamp > this.lockTimeout) {
      this.writeLock();
    } else if (lock.tabId !== this.tabId) {
      this.applyPunishment();
    }
  }

  private heartbeat(): void {
    const lock = this.readLock();
    const now = Date.now();

    if (!lock || lock.tabId === this.tabId || now - lock.timestamp > this.lockTimeout) {
      this.writeLock();
    } else if (lock.tabId !== this.tabId) {
      this.applyPunishment();
    }
  }

  private readLock(): { tabId: string; timestamp: number } | null {
    try {
      const value = localStorage.getItem(this.lockKey);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  private writeLock(): void {
    try {
      localStorage.setItem(
        this.lockKey,
        JSON.stringify({ tabId: this.tabId, timestamp: Date.now() })
      );
    } catch {
      // ignore
    }
  }

  private releaseLock = (): void => {
    const lock = this.readLock();
    if (lock && lock.tabId === this.tabId) {
      localStorage.removeItem(this.lockKey);
    }
  };

  private handleStorageChange = (event: StorageEvent): void => {
    if (event.key === this.lockKey) {
      const lock = this.readLock();
      if (lock && lock.tabId !== this.tabId) {
        this.applyPunishment();
      }
    }
  };

  private applyPunishment(): void {
    if (this.isPunished) return;
    this.isPunished = true;

    let punishmentDelay = this.punishmentDelays[
      Math.min(this.numPunishmentsGiven, this.punishmentDelays.length - 1)
    ];
    this.numPunishmentsGiven++;

    if (this.startPenaltyCallback) {
      this.startPenaltyCallback(punishmentDelay);
    }

    setTimeout(() => {
      this.isPunished = false;
    }, punishmentDelay);
  }
}
