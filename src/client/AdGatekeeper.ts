export type AdblockState = "blocked" | "clear";

type Listener = (state: AdblockState, canShowAds: boolean) => void;

/**
 * Once a blocker is ever detected we suppress the in-game ad forever, so the
 * verdict is persisted. Safe to store client-side: forging it only opts a user
 * OUT of ads (which a blocker already does), so there's nothing to exploit.
 */
const ADBLOCK_STORAGE_KEY = "adblock-detected";

export interface AdGatekeeperOptions {
  /** Background re-check interval. Kept lazy — aggressive polling draws filter-list heat. */
  pollMs?: number;
  /**
   * Adblock probe. Defaults to a DOM bait check; injectable so the state
   * machine can be unit-tested without a real blocker (jsdom does no layout,
   * so the bait always reads "blocked" there).
   */
  probe?: () => Promise<boolean>;
}

/**
 * Decides whether the *intrusive* in-game ad may show.
 *
 * Ad-block users are far more ad-sensitive, so once we ever detect a blocker
 * this session the ad is suppressed PERMANENTLY — disabling the blocker does
 * NOT unlock it. The ad shows only for users who have been continuously
 * blocker-free. `canShowAds` is true only in 'clear'; 'blocked' is terminal.
 *
 * Orthogonal to `window.adsEnabled` (the entitlement gate for adfree /
 * CrazyGames users). Construct/start it only for ad-eligible users — paid /
 * adfree users never build one, so no bait element or polling runs for them.
 * A fast external signal (e.g. Admiral's `measure.detected`) feeds `seed()`.
 */
export class AdGatekeeper {
  private state: AdblockState | null = null;
  private listeners = new Set<Listener>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private readonly pollMs: number;
  private readonly probe: () => Promise<boolean>;

  constructor(opts: AdGatekeeperOptions = {}) {
    this.pollMs = opts.pollMs ?? 15000;
    this.probe = opts.probe ?? (() => this.baitBlocked());
  }

  /** True only once we've confirmed the user has been blocker-free all session. */
  get canShowAds(): boolean {
    return this.state === "clear";
  }

  /** Subscribe to state changes. Emits the current state immediately if known. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.state !== null) fn(this.state, this.canShowAds);
    return () => this.listeners.delete(fn);
  }

  /**
   * Run `fn` once the gate is (or becomes) clear. Fires synchronously if
   * already clear. Never fires once 'blocked' has latched. Returns an
   * unsubscribe for the still-pending case.
   */
  whenClear(fn: () => void): () => void {
    if (this.canShowAds) {
      fn();
      return () => {};
    }
    const off = this.subscribe((_state, canShowAds) => {
      if (canShowAds) {
        off();
        fn();
      }
    });
    return off;
  }

  /**
   * Feed an external adblock reading (e.g. Admiral's `measure.detected`) into
   * the state machine as a fast, reliable signal. Ignored until started and
   * once 'blocked' has latched.
   */
  seed(blocked: boolean): void {
    if (!this.started) return;
    this.applyReading(blocked);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // A blocker detected in any past session suppresses the ad forever — no
    // need to probe or listen at all.
    if (readPersistedBlock()) {
      this.transition("blocked");
      return;
    }
    void this.evaluate();
    // Toggling an extension means leaving the tab and coming back — re-check on
    // return. Cheap, event-driven, and catches a mid-session enable before the
    // in-game ad fires, without hammering a poll.
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("focus", this.onFocus);
    this.pollTimer = setInterval(() => void this.evaluate(), this.pollMs);
  }

  stop(): void {
    this.stopProbing();
    this.listeners.clear();
    this.started = false;
  }

  private stopProbing(): void {
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("focus", this.onFocus);
  }

  private onVisibility = (): void => {
    if (!document.hidden) void this.evaluate();
  };

  private onFocus = (): void => void this.evaluate();

  private async evaluate(): Promise<void> {
    if (this.state === "blocked") return; // terminal — nothing left to check
    const blocked = await this.probe();
    if (!this.started) return; // stopped mid-probe; applyReading guards a late latch
    this.applyReading(blocked);
  }

  /** Fold a raw adblock reading into the state machine. 'blocked' is terminal. */
  private applyReading(blocked: boolean): void {
    if (this.state === "blocked") return; // once blocked, always blocked
    if (blocked) {
      persistBlock(); // suppress the in-game ad in this and every future session
      this.transition("blocked");
      this.stopProbing(); // suppressed forever — no need to keep probing
      return;
    }
    this.transition("clear");
  }

  private transition(next: AdblockState): void {
    if (next === this.state) return;
    this.state = next;
    for (const fn of this.listeners) fn(next, this.canShowAds);
  }

  /** DOM bait detector: a blocker hides/collapses elements with ad-like classes. */
  private async baitBlocked(): Promise<boolean> {
    const bait = document.createElement("div");
    bait.className = "adsbox ad-banner pub_300x250";
    bait.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;";
    document.body.appendChild(bait);
    await new Promise(requestAnimationFrame); // let the blocker act
    const blocked = bait.offsetHeight === 0 || bait.offsetParent === null;
    bait.remove();
    return blocked;
  }
}

function readPersistedBlock(): boolean {
  try {
    return window.localStorage.getItem(ADBLOCK_STORAGE_KEY) === "1";
  } catch {
    return false; // storage disabled (private mode, etc.)
  }
}

function persistBlock(): void {
  try {
    window.localStorage.setItem(ADBLOCK_STORAGE_KEY, "1");
  } catch {
    /* best-effort; falls back to session-only suppression */
  }
}

export const adGatekeeper = new AdGatekeeper();
