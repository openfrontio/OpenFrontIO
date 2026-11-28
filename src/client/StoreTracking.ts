import type {
  StoreEventsBody,
  StoreOpenSource,
  StorePlacement,
} from "@openfront/shared/ApiSchemas";
import { getApiBase } from "./ApiBase";
import { peekAuthHeader } from "./Auth";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { isSteamShell } from "./DesktopShell";

// Store analytics. An impression is a card at least half visible for a full
// second, counted once per item per page view; a click is counted once per
// item per page view. Events are batched and sent every 30 s and when the page
// is hidden or closed.

const IMPRESSION_MS = 1000;
// Share of a card that must be in view for its second to count.
const IMPRESSION_RATIO = 0.5;
const FLUSH_MS = 30_000;
// The API takes at most 50 events a request (StoreEventsBodySchema). A full
// batch is about 5.5 KB with typical keys, 11 KB at the 120-character cap.
// Browsers cap all in-flight keepalive bodies at 64 KiB together, so a
// pagehide flush of several hundred queued events would lose the later
// batches. Per-visit dedupe and the 30 s flush keep the queue far below.
const MAX_BATCH = 50;
// The API's limit on an item key (StoreEventsBodySchema): one longer key
// would 400 its whole batch, so it is dropped here instead.
const MAX_ITEM_KEY = 120;

type StoreEvent = StoreEventsBody["events"][number];
type ItemEvent = Exclude<StoreEvent, { type: "open" }>;
type OpenEvent = Extract<StoreEvent, { type: "open" }>;

// The key a store item is tracked under. The card is the unit shown and
// scored, so a pattern is always `pattern:<name>`: a palette variant
// (`pattern:<name>:<palette>`) folds into it. Every other key is already a
// card's key. The API folds palette keys the same way.
export function storeItemKey(key: string): string {
  if (!key.startsWith("pattern:")) return key;
  const [, name] = key.split(":");
  return `pattern:${name}`;
}

// The custom Plutonium amount card's key. It has no catalog entry; the API
// lists it under this key (pack:custom_amount, type "pack").
export const CUSTOM_AMOUNT_ITEM_KEY = "pack:custom_amount";

const OPEN_SOURCES: ReadonlySet<string> = new Set<StoreOpenSource>([
  "nav",
  "news_banner",
  "insufficient_currency",
  "purchase_nudge",
  "resume_purchase",
  "inventory",
  "equipped",
  "subscription",
  "username",
  "host_lobby",
  "matchmaking",
  "clan",
  "affiliate_link",
  "link",
  "other",
]);

/**
 * The entry point that opened the store, from the open's args. Entry points
 * name themselves with `from=<source>` in the store's hash; the menu's Store
 * button opens it with no args at all; a creator link (`#affiliate=`) passes
 * only its code; any other store URL (a reload, a shared or typed link) is
 * "link".
 */
export function storeOpenSource(
  args?: Record<string, unknown>,
): StoreOpenSource {
  if (args === undefined) return "nav";
  if (typeof args.from === "string") {
    return OPEN_SOURCES.has(args.from)
      ? (args.from as StoreOpenSource)
      : "other";
  }
  if (typeof args.affiliateCode === "string") return "affiliate_link";
  return "link";
}

export function storePlatform(): StoreEventsBody["platform"] {
  if (isSteamShell()) return "steam";
  if (crazyGamesSDK.isOnCrazyGames()) return "crazygames";
  return "web";
}

// Fire and forget. keepalive lets the request outlive the page on pagehide.
// Errors are swallowed and nothing about the body or player is logged.
export function sendStoreEvents(body: StoreEventsBody): void {
  try {
    // Read the cached token synchronously: analytics never triggers a refresh,
    // and fetch must be issued in this tick so it survives pagehide.
    const auth = peekAuthHeader();
    fetch(`${getApiBase()}/store/events`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(auth !== "" ? { Authorization: auth } : {}),
      },
      body: JSON.stringify(body),
    }).catch(() => {
      // Analytics never surfaces an error.
    });
  } catch {
    // Analytics never surfaces an error.
  }
}

export interface StoreTrackerDeps {
  send?: (body: StoreEventsBody) => void;
}

interface Watched {
  item: string;
  placement: StorePlacement;
  timer: ReturnType<typeof setTimeout> | null;
  // At least IMPRESSION_RATIO of the card is in view, as last reported.
  visible: boolean;
}

export class StoreTracker {
  private readonly send: (body: StoreEventsBody) => void;
  private readonly interval: ReturnType<typeof setInterval>;
  private observer: IntersectionObserver | null = null;
  private readonly watched = new Map<Element, Watched>();
  private queue: ItemEvent[] = [];
  private opens: OpenEvent[] = [];
  private seenImpressions = new Set<string>();
  private seenClicks = new Set<string>();

  constructor(deps: StoreTrackerDeps = {}) {
    this.send = deps.send ?? sendStoreEvents;
    this.interval = setInterval(() => this.flush(), FLUSH_MS);
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private readonly onPageHide = () => this.flush();
  // Intersection is geometric and ignores whether the tab is in front, so a
  // hidden tab stops every pending impression; coming back needs a fresh
  // second of view.
  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") {
      for (const w of this.watched.values()) this.stopTimer(w);
      this.flush();
      return;
    }
    for (const w of this.watched.values()) {
      if (w.visible) this.startTimer(w);
    }
  };

  beginPageView(): void {
    this.seenImpressions.clear();
    this.seenClicks.clear();
    // Lit keeps a card's element when the next view shows the same item in
    // the same slot, and observe() then changes nothing. Watch each card
    // afresh, so its next second in view counts for this view: the observer
    // reports a newly observed element's state straight away.
    for (const [el, w] of this.watched) {
      this.stopTimer(w);
      w.visible = false;
      this.observer?.unobserve(el);
      this.observer?.observe(el);
    }
  }

  // Call releaseDetached() once per pass over the cards, not per card.
  observe(el: Element, key: string, placement: StorePlacement): void {
    const item = storeItemKey(key);
    const known = this.watched.get(el);
    if (
      known !== undefined &&
      known.item === item &&
      JSON.stringify(known.placement) === JSON.stringify(placement)
    ) {
      return;
    }
    this.observer ??= new IntersectionObserver(
      (entries) => this.onEntries(entries),
      { threshold: IMPRESSION_RATIO },
    );
    if (known !== undefined) {
      // Lit reuses a card element for another item when the list changes.
      // Watch it afresh so the impression is for what it shows now.
      this.stopTimer(known);
      this.observer.unobserve(el);
    }
    this.watched.set(el, { item, placement, timer: null, visible: false });
    this.observer.observe(el);
  }

  // Lit replaces cards when a tab or list changes. Stop watching the ones it
  // dropped so a long session does not keep them, and their timers, alive.
  // One walk of the watched cards: the caller runs it once per update.
  releaseDetached(): void {
    for (const [el, w] of this.watched) {
      if (el.isConnected) continue;
      if (w.timer !== null) clearTimeout(w.timer);
      this.observer?.unobserve(el);
      this.watched.delete(el);
    }
  }

  private onEntries(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const w = this.watched.get(entry.target);
      if (w === undefined) continue;
      this.stopTimer(w);
      // The observer also reports crossings back below the threshold, still
      // intersecting, so the ratio decides, not isIntersecting alone.
      w.visible =
        entry.isIntersecting && entry.intersectionRatio >= IMPRESSION_RATIO;
      if (w.visible && document.visibilityState !== "hidden") {
        this.startTimer(w);
      }
    }
  }

  private startTimer(w: Watched): void {
    this.stopTimer(w);
    w.timer = setTimeout(() => {
      w.timer = null;
      if (this.seenImpressions.has(w.item)) return;
      this.seenImpressions.add(w.item);
      this.enqueue({
        type: "impression",
        item: w.item,
        placement: w.placement,
      });
    }, IMPRESSION_MS);
  }

  private stopTimer(w: Watched): void {
    if (w.timer === null) return;
    clearTimeout(w.timer);
    w.timer = null;
  }

  click(key: string, placement: StorePlacement): void {
    const item = storeItemKey(key);
    if (this.seenClicks.has(item)) return;
    this.seenClicks.add(item);
    this.enqueue({ type: "click", item, placement });
  }

  /** One store opening, from the entry point that opened it. */
  open(source: StoreOpenSource): void {
    this.opens.push({ type: "open", source });
  }

  private enqueue(event: ItemEvent): void {
    if (event.item.length > MAX_ITEM_KEY) return;
    this.queue.push(event);
  }

  flush(): void {
    if (this.queue.length === 0 && this.opens.length === 0) return;
    const platform = storePlatform();
    // Opens in a request of their own: an API that predates them rejects
    // that request, never the impressions and clicks.
    const opens = this.opens;
    this.opens = [];
    for (let i = 0; i < opens.length; i += MAX_BATCH) {
      this.send({ platform, events: opens.slice(i, i + MAX_BATCH) });
    }
    const events = this.queue;
    this.queue = [];
    for (let i = 0; i < events.length; i += MAX_BATCH) {
      this.send({ platform, events: events.slice(i, i + MAX_BATCH) });
    }
  }

  dispose(): void {
    this.flush();
    clearInterval(this.interval);
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const w of this.watched.values()) {
      if (w.timer !== null) clearTimeout(w.timer);
    }
    this.watched.clear();
    this.observer?.disconnect();
    this.observer = null;
  }
}
