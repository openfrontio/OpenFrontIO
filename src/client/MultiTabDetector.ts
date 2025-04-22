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
    console.log("Starting multi-tab monitoring...");
    this.startPenaltyCallback = startPenalty;
    this.acquireLock();

    this.createInvisibleLockElement();
    console.log("Invisible lock element created.");

    this.heartbeatTimer = setInterval(() => {
      const lock = this.readLock();
      console.log("Checking lock status...");

      if (!lock) {
        console.log("No lock found, acquiring lock...");
        this.acquireLock();
        return;
      }

      console.log(`Lock found: owner=${lock.owner}, timestamp=${lock.timestamp}`);
      
      if (lock.owner === this.tabId || Date.now() - lock.timestamp > this.staleThreshold) {
        console.log("Lock is valid or stale, writing lock...");
        this.writeLock();
        this.isPunished = false;
        return;
      }

      if (!this.isPunished) {
        console.log("Multi-tab detected, applying punishment...");
        this.applyPunishment();
      }
    }, this.heartbeatInterval);
  }

  public stopMonitoring(): void {
    console.log("Stopping multi-tab monitoring...");
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      console.log("Heartbeat timer cleared.");
    }

    if (this.unloadHandler) {
      window.removeEventListener("beforeunload", this.unloadHandler);
      this.unloadHandler = null;
      console.log("Unload handler removed.");
    }

    const lock = this.readLock();
    if (lock?.owner === this.tabId) {
      localStorage.removeItem(this.lockKey);
      console.log("Lock removed from localStorage.");
    }

    this.removeInvisibleLockElement();
    console.log("Invisible lock element removed.");
  }

  private acquireLock(): void {
    console.log("Acquiring lock...");
    const lock = this.readLock();
    if (!lock) {
      console.log("No lock found, writing new lock...");
      this.writeLock();
    }

    this.unloadHandler = () => {
      const lock = this.readLock();
      if (lock?.owner === this.tabId) {
        localStorage.removeItem(this.lockKey);
        console.log("Lock removed on unload.");
      }
    };

    window.addEventListener("beforeunload", this.unloadHandler);
    console.log("Unload handler added.");
  }

  private writeLock(): void {
    console.log("Writing lock to localStorage...");
    localStorage.setItem(
      this.lockKey,
      JSON.stringify({ owner: this.tabId, timestamp: Date.now() }),
    );
  }

  private readLock(): { owner: string; timestamp: number } | null {
    console.log("Reading lock from localStorage...");
    try {
      const raw = localStorage.getItem(this.lockKey);
      if (!raw) {
        console.log("No lock found in localStorage.");
        return null;
      }
      const lock = JSON.parse(raw);
      console.log(`Lock found: owner=${lock.owner}, timestamp=${lock.timestamp}`);
      return lock;
    } catch (error) {
      console.error("Error reading lock from localStorage:", error);
      return null;
    }
  }

  private applyPunishment(): void {
    console.log("Applying punishment...");
    this.isPunished = true;

    const delay =
      this.numPunishmentsGiven >= this.punishmentDelays.length
        ? this.punishmentDelays[this.punishmentDelays.length - 1]
        : this.punishmentDelays[this.numPunishmentsGiven];

    this.numPunishmentsGiven++;

    console.log(`Punishment delay: ${delay}ms`);
    
    if (this.startPenaltyCallback) {
      this.startPenaltyCallback(delay);
    }

    setTimeout(() => {
      console.log("Punishment ended.");
      this.isPunished = false;
    }, delay);
  }

  private createInvisibleLockElement(): void {
    console.log("Checking for invisible lock element...");
    if (!document.getElementById("invisible-lock")) {
      const lockElement = document.createElement("div");
      lockElement.id = "invisible-lock";
      lockElement.style.display = "none"; // Hidden but still in the DOM
      document.body.appendChild(lockElement);
      console.log("Invisible lock element created.");
    }
  }

  private removeInvisibleLockElement(): void {
    console.log("Removing invisible lock element...");
    const lockElement = document.getElementById("invisible-lock");
    if (lockElement) {
      lockElement.remove();
      console.log("Invisible lock element removed.");
    }
  }

  private verifyLockIntegrity(): void {
    console.log("Verifying lock integrity...");
    const lock = this.readLock();

    if (!lock || Date.now() - lock.timestamp > this.staleThreshold) {
      console.log("Lock is invalid or stale, acquiring new lock...");
      this.acquireLock();
    }
  }
}
