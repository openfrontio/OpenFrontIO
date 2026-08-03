import { LiveStream, StreamsFeed } from "../core/ApiSchemas";
import { getStreams } from "./Api";

// One poller for both homepage streaming features.
//
// They used to poll independently — the featured panel every 60s and Streaming Now every
// 90s via setInterval — which is two requests for the same answer. Worse, Streaming Now
// only cleared its interval in disconnectedCallback, and <play-page> is never
// disconnected (Navigation.ts toggles a `hidden` class and removes nothing), so it kept
// polling for the entire session, including all the way through a game.
//
// This module is the single fetch, and it stops: nothing is polled while a game is
// running, while the tab is hidden, or while no component wants the data. There is no
// per-component timer left to leak.

const POLL_MS = 60_000; // matches the endpoint's edge cache; faster just re-fetches bytes
const MAX_AGE_MS = 10 * 60_000; // matches the API's snapshot TTL

export const EMPTY_FEED: StreamsFeed = {
  verifiedAt: "1970-01-01T00:00:00.000Z",
  featured: [],
  live: [],
};

// A feed older than the snapshot TTL means the cron is dead and the edge is serving
// something stale — treat it as "nothing is live" rather than showing a corpse.
export function isFeedFresh(verifiedAt: string, now: number): boolean {
  const built = Date.parse(verifiedAt);
  return Number.isFinite(built) && now - built <= MAX_AGE_MS;
}

// Identity of one broadcast. `startedAt` is what makes a restart distinguishable from
// the same stream, so suppressing a dead broadcast cannot suppress a later genuine one.
export function broadcastKey(stream: LiveStream): string {
  return `${stream.platform}:${stream.channel}:${stream.startedAt}`;
}

type Listener = (feed: StreamsFeed) => void;

class StreamsFeedPoller {
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inGame = false;
  private wired = false;
  private tickInFlight = false;
  private latest: StreamsFeed = EMPTY_FEED;

  // Components subscribe on connect and call the returned function on disconnect.
  // Polling runs only while at least one component wants the data.
  subscribe(fn: Listener): () => void {
    this.wire();
    this.listeners.add(fn);
    // Hand over the cached feed immediately so a newly mounted component renders without
    // waiting a round trip — but re-check freshness rather than trusting the value, since
    // polling stops in-game and while hidden, so `latest` can be arbitrarily old by now.
    this.deliver(fn, this.freshLatest());
    this.resume();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private wire() {
    if (this.wired) return;
    this.wired = true;
    // Stay up through the lobby/queue wait; stop once the game actually starts.
    document.addEventListener("game-starting", () => {
      this.inGame = true;
      this.stop();
    });
    document.addEventListener("leave-lobby", () => {
      this.inGame = false;
      this.resume();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop();
      else this.resume();
    });
  }

  private canPoll(): boolean {
    return this.listeners.size > 0 && !this.inGame && !document.hidden;
  }

  private freshLatest(): StreamsFeed {
    return isFeedFresh(this.latest.verifiedAt, Date.now())
      ? this.latest
      : EMPTY_FEED;
  }

  // A subscriber that throws must not take the feed down for everyone else: the loop
  // that notifies them and the scheduling of the next poll both live in tick().
  private deliver(fn: Listener, feed: StreamsFeed) {
    try {
      fn(feed);
    } catch (e) {
      console.error("streams-feed: listener failed", e);
    }
  }

  // Guarded against double-starting: a second subscriber arriving while the first
  // fetch is still in flight must not kick off its own request.
  private resume() {
    if (!this.canPoll()) return;
    if (this.timer !== null || this.tickInFlight) return;
    void this.tick();
  }

  private stop() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (!this.canPoll()) return;
    this.tickInFlight = true;
    try {
      const feed = await getStreams();
      if (!this.canPoll()) return; // state can change across the await
      this.latest = isFeedFresh(feed.verifiedAt, Date.now())
        ? feed
        : EMPTY_FEED;
      for (const fn of this.listeners) this.deliver(fn, this.latest);
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.tick();
      }, POLL_MS);
    } finally {
      this.tickInFlight = false;
    }
  }
}

export const streamsFeed = new StreamsFeedPoller();
