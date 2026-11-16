import type {
  StoreEventsBody,
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
const FLUSH_MS = 30_000;
const MAX_BATCH = 200;
// The API's limit on an item key (StoreEventsBodySchema): one longer key
// would 400 its whole batch, so it is dropped here instead.
const MAX_ITEM_KEY = 120;

type StoreEvent = StoreEventsBody["events"][number];

// The key a store item is tracked under. The card is the unit shown and
// scored, so a pattern is always `pattern:<name>`: a palette variant
// (`pattern:<name>:<palette>`) folds into it. Every other key is already a
// card's key. The API folds palette keys the same way.
export function storeItemKey(key: string): string {
  if (!key.startsWith("pattern:")) return key;
  const [, name] = key.split(":");
  return `pattern:${name}`;
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
}

export class StoreTracker {
  private readonly send: (body: StoreEventsBody) => void;
  private readonly interval: ReturnType<typeof setInterval>;
  private observer: IntersectionObserver | null = null;
  private readonly watched = new Map<Element, Watched>();
  private queue: StoreEvent[] = [];
  private seenImpressions = new Set<string>();
  private seenClicks = new Set<string>();

  constructor(deps: StoreTrackerDeps = {}) {
    this.send = deps.send ?? sendStoreEvents;
    this.interval = setInterval(() => this.flush(), FLUSH_MS);
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private readonly onPageHide = () => this.flush();
  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") this.flush();
  };

  beginPageView(): void {
    this.seenImpressions.clear();
    this.seenClicks.clear();
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
      { threshold: 0.5 },
    );
    if (known !== undefined) {
      // Lit reuses a card element for another item when the list changes.
      // Watch it afresh so the impression is for what it shows now.
      if (known.timer !== null) clearTimeout(known.timer);
      this.observer.unobserve(el);
    }
    this.watched.set(el, { item, placement, timer: null });
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
      if (w.timer !== null) {
        clearTimeout(w.timer);
        w.timer = null;
      }
      if (!entry.isIntersecting) continue;
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
  }

  click(key: string, placement: StorePlacement): void {
    const item = storeItemKey(key);
    if (this.seenClicks.has(item)) return;
    this.seenClicks.add(item);
    this.enqueue({ type: "click", item, placement });
  }

  private enqueue(event: StoreEvent): void {
    if (event.item.length > MAX_ITEM_KEY) return;
    this.queue.push(event);
  }

  flush(): void {
    if (this.queue.length === 0) return;
    const events = this.queue;
    this.queue = [];
    const platform = storePlatform();
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
