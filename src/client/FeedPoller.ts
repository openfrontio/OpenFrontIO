// One shared poller per API-served homepage feed (streams.json, jinglejam.json).
//
// The streaming panels used to poll independently — the featured panel every 60s and
// Streaming Now every 90s via setInterval — which is two requests for the same answer.
// Worse, Streaming Now only cleared its interval in disconnectedCallback, and
// <play-page> is never disconnected (Navigation.ts toggles a `hidden` class and removes
// nothing), so it kept polling for the entire session, including all the way through a
// game.
//
// A FeedPoller is the single fetch for its feed, and it stops: nothing is polled while a
// game is running, while the tab is hidden, or while no component wants the data. There
// is no per-component timer left to leak.

const POLL_MS = 60_000; // matches the endpoints' edge cache; faster just re-fetches bytes

type Listener<T> = (feed: T) => void;

export interface FeedPollerOptions<T> {
  name: string; // for log lines
  fetch: () => Promise<T>;
  empty: T; // what subscribers see before the first answer, and after a reset
  // Turns a fetched (or cached) feed into what subscribers get: e.g. `empty` when the
  // feed is too old to trust. Re-run on every delivery, since `latest` can sit
  // untouched for a long time while polling is stopped.
  accept?: (feed: T, now: number) => T;
}

export class FeedPoller<T> {
  private listeners = new Set<Listener<T>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inGame = false;
  private wired = false;
  private tickInFlight = false;
  private generation = 0; // bumped by reset(); ticks from an older generation are inert
  private latest: T;

  constructor(private readonly opts: FeedPollerOptions<T>) {
    this.latest = opts.empty;
  }

  // Components subscribe on connect and call the returned function on disconnect.
  // Polling runs only while at least one component wants the data.
  subscribe(fn: Listener<T>): () => void {
    this.wire();
    this.listeners.add(fn);
    // Hand over the cached feed immediately so a newly mounted component renders without
    // waiting a round trip — but re-check it rather than trusting the value, since
    // polling stops in-game and while hidden, so `latest` can be arbitrarily old by now.
    this.deliver(fn, this.accepted(this.latest));
    this.resume();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private accepted(feed: T): T {
    return this.opts.accept ? this.opts.accept(feed, Date.now()) : feed;
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

  // A subscriber that throws must not take the feed down for everyone else: the loop
  // that notifies them and the scheduling of the next poll both live in tick().
  private deliver(fn: Listener<T>, feed: T) {
    try {
      fn(feed);
    } catch (e) {
      console.error(`${this.opts.name}: listener failed`, e);
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
    // A tick can be awaiting the fetch when reset() lands. Everything it touches
    // afterwards — the cached feed, the listeners, tickInFlight, the next timer — would
    // by then belong to whatever came after the reset, so an orphaned tick must do
    // nothing at all.
    const generation = this.generation;
    const current = () => generation === this.generation;
    this.tickInFlight = true;
    try {
      const feed = await this.opts.fetch();
      if (current() && this.canPoll()) {
        // canPoll can flip across the await; if it did, keep the previous feed and let
        // the resume path start a fresh tick.
        this.latest = this.accepted(feed);
        for (const fn of this.listeners) this.deliver(fn, this.latest);
      }
    } catch (e) {
      // The Api fetchers swallow fetch and validation errors themselves, but they can
      // still throw if the bundled fallback ever fails to parse. Scheduling below is
      // outside this try for that reason: one bad fetch must not end polling for the
      // whole session.
      console.warn(`${this.opts.name}: fetch failed`, e);
    } finally {
      // If a reset happened, the newer tick owns the flag — leave it alone.
      if (current()) this.tickInFlight = false;
    }
    if (current() && this.canPoll() && this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.tick();
      }, POLL_MS);
    }
  }

  // Test seam: pollers are module singletons, so their state would otherwise leak
  // between tests in a file and make them order-dependent. Not used in production.
  reset() {
    this.generation++; // orphan any tick currently awaiting the fetch
    this.stop();
    this.listeners.clear();
    this.inGame = false;
    this.tickInFlight = false;
    this.latest = this.opts.empty;
  }
}
