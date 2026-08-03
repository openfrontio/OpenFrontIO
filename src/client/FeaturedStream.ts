import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { LiveStream, StreamsFeed } from "../core/ApiSchemas";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { isDesktopShell } from "./DesktopShell";
import { broadcastKey, streamsFeed, watchUrl } from "./StreamsFeed";
import { translateText } from "./Utils";

// Homepage "featured stream" panel: embeds a Twitch channel and shows ONLY while it is
// actually live, then hides. Data comes from the shared streams feed (GET /streams.json,
// with a bundled empty fallback in resources/streams.json): `featured` is a list of
// verified-live broadcasts in admin priority order (e.g. the OFM channel for tournaments
// ahead of the OF channel for releases). Empty = nothing to show (renders nothing).
//
// Liveness is decided server-side: the API polls Twitch Helix on a cron and serves only
// broadcasts that are live right now, each carrying a `startedAt` no static config could
// produce. So `featured[0]` is simply what to embed. The client used to work this out
// itself by mounting a real autoplaying Twitch.Player per configured channel and reading
// its ONLINE/OFFLINE events, which cost ~300 Twitch requests on every page load
// (measured) while the panel stayed invisible. Now nothing Twitch-related loads until
// there is a live broadcast.
//
// The player is still watched once mounted: OFFLINE/ENDED hides the panel, which covers
// the stream ending mid-session and the ~3 min worst-case staleness of the served feed
// (2 min cron + 60s edge cache). An offline-at-load channel fires READY -> ENDED with no
// OFFLINE, so the initial state is read synchronously with getEnded() on READY.
//
// Crucially, that verdict is REMEMBERED (see `dead`). It previously was not, so a feed
// naming an offline channel re-booted a full player every 60 seconds indefinitely.

interface TwitchPlayer {
  addEventListener(event: string, cb: () => void): void;
  getEnded(): boolean;
  play(): void;
  pause(): void;
  setMuted(muted: boolean): void;
  destroy?(): void;
}
interface TwitchPlayerCtor {
  new (el: HTMLElement, opts: Record<string, unknown>): TwitchPlayer;
  READY: string;
  ONLINE: string;
  OFFLINE: string;
  ENDED: string;
}
interface TwitchGlobal {
  Player: TwitchPlayerCtor;
}
declare global {
  interface Window {
    Twitch?: TwitchGlobal;
  }
}

export type Corner = "tl" | "tr" | "bl" | "br";
const CORNER_KEY = "featured-stream-corner";
const MIN_KEY = "featured-stream-minimized";
const CLOSED_KEY = "featured-stream-closed"; // "hide for today" (ad-free), scoped to the day

// Local calendar day, used to scope the "closed" and "minimized" states to the current stream:
// each is stored with the day it was set and ignored once the day changes, so the panel resets
// for the next day's stream instead of persisting forever.
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const CORNER_CLASS: Record<Corner, string> = {
  tl: "top-4 left-4",
  tr: "top-4 right-4",
  bl: "bottom-4 left-4",
  br: "bottom-4 right-4",
};

// Nearest corner for a panel centered at (cx, cy) within a vw x vh viewport. Pure for tests.
export function cornerFromCenter(
  cx: number,
  cy: number,
  vw: number,
  vh: number,
): Corner {
  return `${cy > vh / 2 ? "b" : "t"}${cx > vw / 2 ? "r" : "l"}` as Corner;
}

// True once a panel centered at (cx, cy) has been dragged past an edge of the vw x vh
// viewport (its center is outside it), i.e. more than half of it is off-screen. Pure for tests.
export function isOffFrame(
  cx: number,
  cy: number,
  vw: number,
  vh: number,
): boolean {
  return cx < 0 || cx > vw || cy < 0 || cy > vh;
}

// Which broadcast to embed, or null for "embed nothing". The API serves only channels
// its cron currently sees live, in admin priority order, so this is just the first entry
// we have not already watched die — no client-side probing. Pure for tests.
export function featuredStream(
  feed: StreamsFeed,
  dead: Set<string>,
): LiveStream | null {
  return feed.featured.find((s) => !dead.has(broadcastKey(s))) ?? null;
}

// Touch devices report a coarse pointer; flick-to-dismiss is enabled only there (on desktop
// the same drag just snaps to the nearest corner).
function isCoarsePointer(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

const SDK_SRC = "https://embed.twitch.tv/embed/v1.js";
let sdkPromise: Promise<TwitchGlobal> | undefined;
function loadTwitchSdk(): Promise<TwitchGlobal> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.Twitch?.Player) return resolve(window.Twitch);
    const s = document.createElement("script");
    s.src = SDK_SRC;
    s.async = true;
    s.onload = () =>
      window.Twitch?.Player
        ? resolve(window.Twitch)
        : reject(new Error("Twitch SDK missing"));
    s.onerror = () => reject(new Error("Twitch SDK failed to load"));
    document.head.appendChild(s);
  });
  return sdkPromise;
}

@customElement("featured-stream")
export class FeaturedStream extends LitElement {
  @state() private live = false;
  @state() private inGame = false;
  @state() private minimized = false;
  @state() private corner: Corner = "br"; // which screen corner the panel snaps to
  @state() private dragPos: { x: number; y: number } | null = null; // free pos while dragging
  @state() private dismissed = false; // closed for this visit; only ⊘ persists it
  @state() private stream: LiveStream | null = null; // broadcast the API reports live

  private player?: TwitchPlayer;
  private mountGen = 0; // bumped each mount; events from older mounts are ignored
  // Broadcasts whose own player told us they are not actually live. Without this, a feed
  // listing an offline channel re-mounted a full Twitch player on every poll, forever:
  // goOffline() clears `stream` and `player`, so a "same channel, already mounted" guard
  // can never fire. Keyed on the broadcast, so a genuine restart still mounts.
  private dead = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private dragOff = { x: 0, y: 0 };
  private dragStart = { x: 0, y: 0 };
  private dragging = false;
  private dragMoved = false;

  // Light DOM so Tailwind classes apply (matches HomepagePromos).
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    const saved = localStorage.getItem(CORNER_KEY);
    if (saved === "tl" || saved === "tr" || saved === "bl" || saved === "br")
      this.corner = saved;
    // Minimized state is scoped to the current day: restore it only if it was set today, and
    // drop a stale value so the next day's stream starts expanded.
    const minDay = localStorage.getItem(MIN_KEY);
    this.minimized = minDay === todayKey();
    if (minDay && !this.minimized) localStorage.removeItem(MIN_KEY);
    // Stay up through the lobby/queue wait; hide only once the game actually starts.
    document.addEventListener("game-starting", this.onGameStart);
    document.addEventListener("leave-lobby", this.onLeave);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("game-starting", this.onGameStart);
    document.removeEventListener("leave-lobby", this.onLeave);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.teardownPlayer();
  }

  async firstUpdated() {
    // Never on CrazyGames or the desktop (Steam) shell: a Twitch embed carries Twitch's own
    // ads and is third-party content, which breaks CrazyGames' "SDK ads only" policy and
    // Steam's no-in-game-ads rules (and can't satisfy Twitch's parent-domain check in the
    // shell). Matches how the rest of the app suppresses promos off the open web.
    if (crazyGamesSDK.isOnCrazyGames() || isDesktopShell()) return;
    // An ad-free user who chose "hide for today" stays hidden for the rest of that day
    // (only that button writes this key, so an ordinary close never suppresses a later visit).
    // A value from an earlier day is stale: drop it so the next day's stream shows again.
    const closedDay = localStorage.getItem(CLOSED_KEY);
    if (closedDay === todayKey()) {
      this.dismissed = true;
      return;
    }
    if (closedDay) localStorage.removeItem(CLOSED_KEY);
    // The shared poller owns the fetch cadence and stops itself in-game and while the
    // tab is hidden; this component only reacts to what it is handed.
    this.unsubscribe = streamsFeed.subscribe((feed) => {
      this.onFeed(feed).catch((e) =>
        console.error("featured-stream: feed handling failed", e),
      );
    });
  }

  // The panel stays up through the lobby/queue wait and hides only once the game actually
  // starts (Main dispatches game-starting at prestart). The shared poller stops fetching
  // in-game on its own, so a stream coming online can't mount an autoplaying player
  // behind the hidden panel — an obscured embed (Twitch ToS). Pause the current player.
  private onGameStart = () => {
    this.inGame = true;
    try {
      this.player?.pause();
    } catch {
      /* ignore */
    }
  };
  private onLeave = () => {
    this.inGame = false;
  };

  // React to what the API says is live. The feed is authoritative — nothing here probes
  // Twitch to find out.
  private async onFeed(feed: StreamsFeed) {
    if (this.inGame || this.dismissed) return;
    const next = featuredStream(feed, this.dead);
    if (next === null) {
      this.goOffline();
      return;
    }
    // Same broadcast AND actually mounted. The `this.player` term matters: mountPlayer
    // has several exits that leave `stream` set with no player (SDK blocked, mount node
    // missing, a game starting mid-await). Without it, every later tick would take this
    // branch and the mount would never be retried — a permanently blank card. It cannot
    // reopen the old remount loop, because a broadcast that reported offline is filtered
    // out by featuredStream() above and never reaches here.
    if (
      this.stream &&
      this.player &&
      broadcastKey(this.stream) === broadcastKey(next)
    ) {
      this.kickPlay(); // already embedding it; resume if a game had paused it
      return;
    }
    this.stream = next;
    await this.updateComplete; // render the card so the mount node exists
    await this.mountPlayer(next);
  }

  // Nothing to show: drop the card (and the mount node with it) and stop streaming.
  private goOffline() {
    this.stream = null;
    this.live = false;
    this.mountGen++; // stale player callbacks fail fresh() and become no-ops
    this.teardownPlayer();
  }

  private async mountPlayer(stream: LiveStream) {
    if (this.inGame || this.dismissed) return; // never mount behind a hidden/dismissed panel
    let Twitch: TwitchGlobal;
    try {
      Twitch = await loadTwitchSdk();
    } catch (e) {
      // SDK blocked (extension, network): the next feed tick retries rather than never.
      console.error("featured-stream: Twitch SDK load failed", e);
      if (this.dismissed) return;
      this.goOffline();
      return;
    }
    // A close (or a game start) during the SDK load must not mount.
    if (this.inGame || this.dismissed) return;
    if (this.stream !== stream) return; // superseded while the SDK loaded
    const channel = stream.channel;
    const host = this.querySelector(
      "#featured-stream-mount",
    ) as HTMLElement | null;
    if (!host) return; // no mount node: the next feed tick retries
    this.teardownPlayer(); // destroy the previous player so its listeners can't fire
    host.innerHTML = "";
    const gen = ++this.mountGen;
    const fresh = () => gen === this.mountGen; // ignore events from a superseded mount
    const player = new Twitch.Player(host, {
      channel,
      parent: [window.location.hostname], // bare host; self-adapts to any domain/subdomain
      muted: true, // required for autoplay
      autoplay: true,
      width: "100%",
      height: "100%",
    });
    this.player = player;
    const P = Twitch.Player;
    // The API already said this broadcast is live, so these events mean it *stopped* (or
    // the served feed is inside its ~3 min staleness window). Record the verdict so we
    // never boot a player for this broadcast again, then hide. Remembering it is what
    // stops an offline-but-listed channel re-mounting on every poll, forever.
    const ended = () => {
      if (!fresh()) return;
      this.dead.add(broadcastKey(stream));
      this.goOffline();
    };
    player.addEventListener(P.READY, () => {
      if (!fresh()) return;
      // offline-at-load = READY -> ENDED (no OFFLINE); read state synchronously here
      if (player.getEnded()) ended();
      else this.setLive();
    });
    player.addEventListener(P.ONLINE, () => fresh() && this.setLive());
    player.addEventListener(P.OFFLINE, ended);
    player.addEventListener(P.ENDED, ended);
  }

  private teardownPlayer() {
    try {
      this.player?.destroy?.();
    } catch {
      /* ignore */
    }
    this.player = undefined;
  }

  private setLive() {
    this.live = true;
    this.kickPlay();
  }

  // Autoplay can be blocked while the panel is hidden; once it's visible, nudge playback.
  // Do NOT touch mute here — respect the user's choice (initial load is muted for
  // autoplay; if they unmuted to listen, it stays unmuted even when minimized).
  private kickPlay() {
    if (!this.present()) return;
    void this.updateComplete.then(() => {
      try {
        this.player?.play();
      } catch {
        /* user can press play in the embed */
      }
    });
  }

  // present = rendered & playing (live, not in a game). minimized is a sub-state that
  // keeps the player mounted and streaming, just visually collapsed to the header bar.
  private present(): boolean {
    return this.live && !this.inGame;
  }

  // `url` is optional in the schema, so derive it rather than letting the click become a
  // silent no-op. Shared with the Streaming Now panel so the derivation stays
  // platform-aware in both.
  private openStream = () => {
    const stream = this.stream;
    if (stream) window.open(watchUrl(stream), "_blank", "noopener");
  };

  // The header is a drag handle: a click (no drag) opens the stream, a drag (past a small
  // threshold) snaps the panel to the nearest corner. Buttons inside are excluded so the
  // open/minimize controls work; the Twitch player is a separate iframe (its controls are
  // never intercepted).
  private onDragDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    this.dragOff = { x: 0, y: 0 };
    const card = this.querySelector(
      "#featured-stream-card",
    ) as HTMLElement | null;
    if (card) {
      const r = card.getBoundingClientRect();
      this.dragOff = { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragging = true;
    this.dragMoved = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  private onDragMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    if (
      !this.dragMoved &&
      Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) < 5
    )
      return; // below threshold -> still a click, not a drag
    this.dragMoved = true;
    this.dragPos = {
      x: e.clientX - this.dragOff.x,
      y: e.clientY - this.dragOff.y,
    };
  };
  private onDragUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.dragMoved && this.dragPos) {
      const card = this.querySelector(
        "#featured-stream-card",
      ) as HTMLElement | null;
      const cx = this.dragPos.x + (card?.offsetWidth ?? 360) / 2;
      const cy = this.dragPos.y + (card?.offsetHeight ?? 200) / 2;
      // Touch only: flicking the panel off the edge closes it for this page visit. A
      // flick is a casual gesture, so it deliberately never persists — hiding for the
      // day is only ever the explicit ⊘.
      if (
        isCoarsePointer() &&
        isOffFrame(cx, cy, window.innerWidth, window.innerHeight)
      ) {
        this.dismiss(false);
        return;
      }
      this.corner = cornerFromCenter(
        cx,
        cy,
        window.innerWidth,
        window.innerHeight,
      );
      localStorage.setItem(CORNER_KEY, this.corner);
      this.dragPos = null;
    } else {
      this.openStream();
    }
  };

  // A canceled pointer (the browser took over the gesture, e.g. a system swipe) is neither a
  // click nor a drag release: just reset drag state so we don't open, snap, or dismiss.
  private onDragCancel = () => {
    this.dragging = false;
    this.dragMoved = false;
    this.dragPos = null;
  };

  // Close the panel. For ad-free users (the x button, or a flick) the close persists for the
  // current day via CLOSED_KEY, so it stays gone across reloads that day and resets for the next
  // day's stream; for ad-supported users the mobile flick is session-only. Either way, stop
  // probing and tear the player down so nothing keeps streaming behind the hidden panel.
  private dismiss(persist: boolean) {
    if (persist) localStorage.setItem(CLOSED_KEY, todayKey());
    this.dismissed = true;
    this.dragPos = null;
    this.mountGen++; // stale player callbacks fail fresh() and become no-ops
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.teardownPlayer();
  }

  private toggleMinimize = () => {
    this.minimized = !this.minimized;
    // Scope the minimized state to the current day too (matches the close): store the day when
    // collapsing, clear it when expanding.
    if (this.minimized) localStorage.setItem(MIN_KEY, todayKey());
    else localStorage.removeItem(MIN_KEY);
    this.kickPlay(); // resume playback after the resize either way
  };

  // Everyone can minimize and close; ad-free users additionally get "hide for today"
  // (any shop purchase makes a user adfree for life, which zeroes window.adsEnabled).
  // Checked with `=== false` so the extra button doesn't flash before /user/me resolves
  // the entitlement — a click landing before then simply closes for the visit instead.
  private get adFree(): boolean {
    return window.adsEnabled === false;
  }

  // Everyone can close. ✕ is always just for this page visit; only the ad-free ⊘ makes it
  // stick, so a close never silently outlives the visit the user expected it to.
  private onClose = () => this.dismiss(false);
  private onHideToday = () => this.dismiss(true);

  render() {
    if (this.stream === null || this.dismissed) return html``;
    const channel = this.stream.channel;
    const min = this.minimized;
    // Twitch pauses the player when it's off-screen/clipped (and hiding the embed violates
    // Twitch ToS), so "minimized" stays a small but still-visible corner thumbnail that
    // keeps streaming. The player must be >=400x300 in every state (Twitch's documented embed
    // minimum; below it autoplay is blocked), so width is floored at 400px and the mount at
    // 300px tall. z above the footer (z-50) and content so it overlays everything.
    return html`
      <div
        id="featured-stream-card"
        class="fixed z-[45000] overflow-hidden rounded-lg bg-black/95 shadow-2xl ring-1 ring-white/10 ${this
          .dragPos
          ? ""
          : "transition-all duration-300 " +
            CORNER_CLASS[this.corner]} ${this.present()
          ? "opacity-100"
          : "pointer-events-none opacity-0"} ${min
          ? "w-[400px]"
          : "w-[clamp(400px,40vw,720px)]"} max-w-[92vw]"
        style=${this.dragPos
          ? `left:${this.dragPos.x}px;top:${this.dragPos.y}px`
          : ""}
        aria-hidden=${this.present() ? "false" : "true"}
      >
        <div
          class="flex h-9 cursor-move touch-none items-center justify-between gap-2 px-2 text-white select-none"
          @pointerdown=${this.onDragDown}
          @pointermove=${this.onDragMove}
          @pointerup=${this.onDragUp}
          @pointercancel=${this.onDragCancel}
        >
          <button
            type="button"
            class="flex min-w-0 items-center gap-2 text-sm font-semibold hover:underline"
            aria-label=${translateText("featured_stream.open_on_twitch", {
              channel,
            })}
            @click=${this.openStream}
          >
            <span
              class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500"
            ></span>
            <span class="shrink-0"
              >${translateText("featured_stream.live")}</span
            >
            <span class="truncate font-bold">${channel}</span>
          </button>
          <div class="flex shrink-0 items-center">
            <button
              class="px-1 text-lg leading-none text-white/70 hover:text-white"
              aria-label=${translateText(
                min ? "featured_stream.expand" : "featured_stream.minimize",
              )}
              @click=${this.toggleMinimize}
            >
              ${min ? "⤢" : "–"}
            </button>
            <button
              class="px-1 text-lg leading-none text-white/70 hover:text-white"
              aria-label=${translateText("common.close")}
              @click=${this.onClose}
            >
              ✕
            </button>
            ${this.adFree
              ? html`<button
                  class="px-1 text-lg leading-none text-white/70 hover:text-white"
                  aria-label=${translateText("featured_stream.hide_today")}
                  title=${translateText("featured_stream.hide_today")}
                  @click=${this.onHideToday}
                >
                  ⊘
                </button>`
              : ""}
          </div>
        </div>
        <div
          id="featured-stream-mount"
          class="aspect-video min-h-[300px] w-full bg-black"
        ></div>
      </div>
    `;
  }
}
