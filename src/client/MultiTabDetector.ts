import {
  ensureUiSessionRuntimeStarted,
  getUiSessionStorageCachedValue,
  removeUiSessionStorage,
  UI_SESSION_RUNTIME_EVENTS,
  type UiSessionNavigationDetail,
  writeUiSessionStorage,
} from "./runtime/UiSessionRuntime";

export class MultiTabDetector {
  private readonly tabId = `${Date.now()}-${Math.random()}`;
  private readonly lockKey = "multi-tab-lock";
  private readonly heartbeatIntervalMs = 1_000;
  private readonly staleThresholdMs = 3_000;
  private readonly onStorageEventBound = this.onStorageEvent.bind(this);
  private readonly onBeforeUnloadBound = this.onBeforeUnload.bind(this);

  private heartbeatTimer: number | null = null;
  private isPunished = false;
  private punishmentCount = 0;
  private startPenaltyCallback: (duration: number) => void = () => {};

  constructor() {
    window.addEventListener("storage", this.onStorageEventBound);
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.beforeUnload,
      this.onBeforeUnloadBound as EventListener,
    );
    void ensureUiSessionRuntimeStarted();
  }

  public startMonitoring(startPenalty: (duration: number) => void): void {
    this.startPenaltyCallback = startPenalty;
    this.writeLock();
    this.heartbeatTimer = window.setInterval(
      () => this.heartbeat(),
      this.heartbeatIntervalMs,
    );
  }

  public stopMonitoring(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const lock = this.readLock();
    if (lock?.owner === this.tabId) {
      void removeUiSessionStorage(this.lockKey);
    }
    window.removeEventListener("storage", this.onStorageEventBound);
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.beforeUnload,
      this.onBeforeUnloadBound as EventListener,
    );
  }

  private heartbeat(): void {
    const now = Date.now();
    const lock = this.readLock();

    if (
      !lock ||
      lock.owner === this.tabId ||
      now - lock.timestamp > this.staleThresholdMs
    ) {
      this.writeLock();
      this.isPunished = false;
      return;
    }

    if (!this.isPunished) {
      this.applyPunishment();
    }
  }

  private onStorageEvent(e: StorageEvent): void {
    if (e.key === this.lockKey && e.newValue) {
      let other: { owner: string; timestamp: number };
      try {
        other = JSON.parse(e.newValue);
      } catch (e) {
        console.error("Failed to parse lock", e);
        return;
      }
      if (other.owner !== this.tabId && !this.isPunished) {
        this.applyPunishment();
      }
    }
  }

  private onBeforeUnload(_event: CustomEvent<UiSessionNavigationDetail>): void {
    const lock = this.readLock();
    if (lock?.owner === this.tabId) {
      void removeUiSessionStorage(this.lockKey);
    }
  }

  private applyPunishment(): void {
    this.isPunished = true;
    this.punishmentCount++;
    const delay = 10_000;
    this.startPenaltyCallback(delay);
    setTimeout(() => {
      this.isPunished = false;
    }, delay);
  }

  private writeLock(): void {
    void writeUiSessionStorage(
      this.lockKey,
      JSON.stringify({ owner: this.tabId, timestamp: Date.now() }),
    );
  }

  private readLock(): { owner: string; timestamp: number } | null {
    const raw = getUiSessionStorageCachedValue(this.lockKey);
    if (typeof raw !== "string" || raw.length === 0) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error("Failed to parse lock", raw, e);
      return null;
    }
  }
}
