import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getFeaturedStream } from "./Api";
import { translateText } from "./Utils";

// Homepage "featured stream" panel: embeds a Twitch channel and shows ONLY while it is
// actually live, then hides. Config comes from getFeaturedStream() (a JSON the API serves
// like news.json, with a bundled fallback in resources/featured-stream.json): an `enabled`
// toggle + a `channels` list. Disabled or no channels = feature off (renders nothing).
// With several channels, the first one that is live wins (e.g. the OFM channel for
// tournaments + the OF channel for releases).
//
// Live detection is client-side via the Twitch Embed SDK (no backend, no API secret).
// Quirks handled: an offline-at-load channel fires READY -> ENDED (no OFFLINE), so we read
// the initial state synchronously with getEnded() on READY; events from a superseded
// player are ignored via a mount generation counter; and if every channel is offline we
// re-check periodically so the panel still appears when a stream goes live later.

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
const RECHECK_MS = 60_000; // re-probe interval when every channel is offline

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
  @state() private dismissed = false; // mobile flick-off; page-visit only, not persisted

  private channels: string[] = [];
  private idx = 0;
  private player?: TwitchPlayer;
  private mountGen = 0; // bumped each mount; events from older mounts are ignored
  private recheckTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.minimized = localStorage.getItem(MIN_KEY) === "true";
    document.addEventListener("join-lobby", this.onJoin);
    document.addEventListener("leave-lobby", this.onLeave);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("join-lobby", this.onJoin);
    document.removeEventListener("leave-lobby", this.onLeave);
    if (this.recheckTimer) clearTimeout(this.recheckTimer);
    this.recheckTimer = null;
    this.teardownPlayer();
  }

  async firstUpdated() {
    // Channels come from the served config (like news.json), with a bundled fallback.
    const cfg = await getFeaturedStream();
    if (!cfg.enabled || cfg.channels.length === 0) return; // off / nothing configured
    this.channels = cfg.channels;
    this.requestUpdate(); // channels is not reactive; force the card (+ mount node) to render
    await this.updateComplete;
    void this.start();
  }

  private onJoin = () => {
    this.inGame = true; // hide while in a lobby/game
    // Stop probing while in a game: a pending recheck (or a stream coming online) must not
    // mount a fresh autoplaying player behind the hidden panel — an obscured embed (Twitch
    // ToS). Cancel the recheck and pause the current player; we re-probe on leave.
    if (this.recheckTimer) {
      clearTimeout(this.recheckTimer);
      this.recheckTimer = null;
    }
    try {
      this.player?.pause();
    } catch {
      /* ignore */
    }
  };
  private onLeave = () => {
    this.inGame = false;
    if (this.dismissed) return; // dismissed for this page visit: don't resurrect it
    // Back on the homepage: re-probe from the top so liveness is fresh and the panel only
    // reappears (and starts streaming) if a channel is actually live right now.
    if (this.recheckTimer) {
      clearTimeout(this.recheckTimer);
      this.recheckTimer = null;
    }
    this.idx = 0;
    void this.start();
  };

  private start = async () => {
    let Twitch: TwitchGlobal;
    try {
      Twitch = await loadTwitchSdk();
    } catch (e) {
      console.error("featured-stream: Twitch SDK load failed", e);
      return;
    }
    this.mountPlayer(Twitch, this.idx);
  };

  private mountPlayer(Twitch: TwitchGlobal, i: number) {
    if (this.inGame || this.dismissed) return; // never mount behind a hidden/dismissed panel
    const host = this.querySelector(
      "#featured-stream-mount",
    ) as HTMLElement | null;
    const channel = this.channels[i];
    if (!host || !channel) return;
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
    player.addEventListener(P.READY, () => {
      if (!fresh()) return;
      // offline-at-load = READY -> ENDED (no OFFLINE); read state synchronously here
      if (player.getEnded()) this.advance(Twitch);
      else this.setLive(i);
    });
    player.addEventListener(P.ONLINE, () => fresh() && this.setLive(i));
    player.addEventListener(P.OFFLINE, () => fresh() && this.advance(Twitch));
    player.addEventListener(P.ENDED, () => fresh() && this.advance(Twitch));
  }

  private teardownPlayer() {
    try {
      this.player?.destroy?.();
    } catch {
      /* ignore */
    }
    this.player = undefined;
  }

  private setLive(i: number) {
    this.idx = i;
    this.live = true;
    this.kickPlay();
  }

  // Current channel offline -> try the next configured one. Bumping mountGen first makes
  // the current player's remaining events no-ops (so a duplicate OFFLINE/ENDED can't skip
  // a channel). If all channels are offline, re-probe later so the panel can still appear.
  private advance(Twitch: TwitchGlobal) {
    this.mountGen++;
    this.live = false;
    this.idx++;
    if (this.idx < this.channels.length) {
      this.mountPlayer(Twitch, this.idx);
    } else {
      this.teardownPlayer();
      this.scheduleRecheck(Twitch);
    }
  }

  private scheduleRecheck(Twitch: TwitchGlobal) {
    if (this.recheckTimer) clearTimeout(this.recheckTimer);
    this.recheckTimer = setTimeout(() => {
      this.recheckTimer = null;
      this.idx = 0;
      this.mountPlayer(Twitch, 0);
    }, RECHECK_MS);
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

  private openStream = () => {
    const channel = this.channels[this.idx];
    if (channel)
      window.open(`https://twitch.tv/${channel}`, "_blank", "noopener");
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
      // Touch only: flicking the panel off the edge dismisses it for this page visit.
      if (
        isCoarsePointer() &&
        isOffFrame(cx, cy, window.innerWidth, window.innerHeight)
      ) {
        this.dismiss();
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

  // Hide the panel for the rest of this page visit. Deliberately NOT persisted: a refresh or
  // the next visit brings it back (a light "not now", not a permanent opt-out). Stop probing
  // and tear the player down so nothing keeps streaming behind the hidden panel.
  private dismiss() {
    this.dismissed = true;
    this.dragPos = null;
    this.mountGen++; // stale player callbacks fail fresh() and become no-ops
    if (this.recheckTimer) {
      clearTimeout(this.recheckTimer);
      this.recheckTimer = null;
    }
    this.teardownPlayer();
  }

  private toggleMinimize = () => {
    this.minimized = !this.minimized;
    localStorage.setItem(MIN_KEY, String(this.minimized));
    this.kickPlay(); // resume playback after the resize either way
  };

  render() {
    if (!this.channels.length || this.dismissed) return html``;
    const channel = this.channels[this.idx] ?? "";
    const min = this.minimized;
    // Twitch pauses the player when it's off-screen/clipped (and hiding the embed violates
    // Twitch ToS), so "minimized" stays a small but still-visible corner thumbnail that
    // keeps streaming. z above the footer (z-50) and content so it overlays everything.
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
          ? "w-[360px]"
          : "w-[clamp(340px,40vw,720px)] max-w-[92vw]"}"
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
          <button
            class="shrink-0 px-1 text-lg leading-none text-white/70 hover:text-white"
            aria-label=${translateText(
              min ? "featured_stream.expand" : "featured_stream.minimize",
            )}
            @click=${this.toggleMinimize}
          >
            ${min ? "⤢" : "–"}
          </button>
        </div>
        <div
          id="featured-stream-mount"
          class="aspect-video w-full bg-black"
        ></div>
      </div>
    `;
  }
}
