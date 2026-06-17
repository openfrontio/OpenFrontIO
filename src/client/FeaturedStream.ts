import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "./ClientEnv";
import { translateText } from "./Utils";

// Homepage "featured stream" panel: embeds a Twitch channel and shows ONLY while it is
// actually live, then hides. Configured via the STREAM_CHANNELS env var (a comma list of
// channel logins) -> BOOTSTRAP_CONFIG -> ClientEnv. Empty/unset = feature off (renders
// nothing). With several channels, the first one that is live wins (e.g. the OF channel
// for releases + the OFM channel for tournaments).
//
// Live detection is done entirely client-side via the Twitch Embed SDK's events (no
// backend, no API secret). The one non-obvious Twitch quirk: a channel that is ALREADY
// offline when the player loads fires READY -> ENDED and never fires OFFLINE, so we read
// the initial state synchronously with getEnded() on READY and rely on ONLINE/OFFLINE
// only for live transitions while the page is open.

interface TwitchPlayer {
  addEventListener(event: string, cb: () => void): void;
  getEnded(): boolean;
  play(): void;
  setMuted(muted: boolean): void;
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

type Corner = "tl" | "tr" | "bl" | "br";
const CORNER_KEY = "featured-stream-corner";
const CORNER_CLASS: Record<Corner, string> = {
  tl: "top-4 left-4",
  tr: "top-4 right-4",
  bl: "bottom-4 left-4",
  br: "bottom-4 right-4",
};

const SDK_SRC = "https://embed.twitch.tv/embed/v1.js";
let sdkPromise: Promise<TwitchGlobal> | undefined;
function loadTwitchSdk(): Promise<TwitchGlobal> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const w = window as unknown as { Twitch?: TwitchGlobal };
    if (w.Twitch?.Player) return resolve(w.Twitch);
    const s = document.createElement("script");
    s.src = SDK_SRC;
    s.async = true;
    s.onload = () =>
      w.Twitch?.Player
        ? resolve(w.Twitch)
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
  @state() private streamTitle = ""; // live broadcast title (HTMLElement.title is reserved)
  @state() private corner: Corner = "br"; // which screen corner the panel snaps to
  @state() private dragPos: { x: number; y: number } | null = null; // free pos while dragging

  private channels: string[] = [];
  private idx = 0;
  private player?: TwitchPlayer;
  private dragOff = { x: 0, y: 0 };

  // Light DOM so Tailwind classes apply (matches HomepagePromos).
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.channels = ClientEnv.streamChannels();
    const saved = localStorage.getItem(CORNER_KEY);
    if (saved === "tl" || saved === "tr" || saved === "bl" || saved === "br")
      this.corner = saved;
    document.addEventListener("join-lobby", this.onJoin);
    document.addEventListener("leave-lobby", this.onLeave);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("join-lobby", this.onJoin);
    document.removeEventListener("leave-lobby", this.onLeave);
  }

  firstUpdated() {
    if (this.channels.length) void this.start();
  }

  private onJoin = () => {
    this.inGame = true; // hide while in a lobby/game
  };
  private onLeave = () => {
    this.inGame = false;
    this.kickPlay();
  };

  // Drag the header to move the panel; on release it snaps to the nearest screen corner.
  private onDragDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return; // let the minimize button work
    const card = this.querySelector(
      "#featured-stream-card",
    ) as HTMLElement | null;
    if (!card) return;
    const r = card.getBoundingClientRect();
    this.dragOff = { x: e.clientX - r.left, y: e.clientY - r.top };
    this.dragPos = { x: r.left, y: r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  private onDragMove = (e: PointerEvent) => {
    if (!this.dragPos) return;
    this.dragPos = {
      x: e.clientX - this.dragOff.x,
      y: e.clientY - this.dragOff.y,
    };
  };
  private onDragUp = () => {
    if (!this.dragPos) return;
    const card = this.querySelector(
      "#featured-stream-card",
    ) as HTMLElement | null;
    const cx = this.dragPos.x + (card?.offsetWidth ?? 360) / 2;
    const cy = this.dragPos.y + (card?.offsetHeight ?? 200) / 2;
    const v = cy > window.innerHeight / 2 ? "b" : "t";
    const h = cx > window.innerWidth / 2 ? "r" : "l";
    this.corner = `${v}${h}` as Corner;
    localStorage.setItem(CORNER_KEY, this.corner);
    this.dragPos = null;
  };

  private async start() {
    let Twitch: TwitchGlobal;
    try {
      Twitch = await loadTwitchSdk();
    } catch (e) {
      console.error("featured-stream: Twitch SDK load failed", e);
      return;
    }
    this.mountPlayer(Twitch, this.idx);
  }

  private mountPlayer(Twitch: TwitchGlobal, i: number) {
    const host = this.querySelector(
      "#featured-stream-mount",
    ) as HTMLElement | null;
    const channel = this.channels[i];
    if (!host || !channel) return;
    host.innerHTML = "";
    this.player = new Twitch.Player(host, {
      channel,
      parent: [window.location.hostname], // bare host; self-adapts to any domain/subdomain
      muted: true, // required for autoplay
      autoplay: true,
      width: "100%",
      height: "100%",
    });
    const P = Twitch.Player;
    this.player.addEventListener(P.READY, () => {
      // offline-at-load = READY -> ENDED (no OFFLINE), so read state synchronously here
      if (this.player?.getEnded()) this.tryNext(Twitch);
      else this.setLive();
    });
    this.player.addEventListener(P.ONLINE, () => this.setLive());
    this.player.addEventListener(P.OFFLINE, () => this.tryNext(Twitch));
    this.player.addEventListener(P.ENDED, () => this.tryNext(Twitch));
  }

  private setLive() {
    this.live = true;
    void this.fetchTitle(this.channels[this.idx]);
    this.kickPlay();
  }

  // The Twitch embed exposes only the channel name, so fetch the broadcast title from a
  // lightweight third-party (decapi, no auth/CORS-open). Falls back to the channel name.
  // For production this can be swapped for a Helix-backed endpoint.
  private async fetchTitle(channel: string) {
    this.streamTitle = channel;
    try {
      const r = await fetch(
        `https://decapi.me/twitch/title/${encodeURIComponent(channel)}`,
      );
      const t = (await r.text()).trim();
      if (r.ok && t) this.streamTitle = t;
    } catch {
      /* keep channel-name fallback */
    }
  }

  // current channel offline -> try the next configured one; none left -> stay hidden
  private tryNext(Twitch: TwitchGlobal) {
    this.live = false;
    this.idx++;
    if (this.idx < this.channels.length) this.mountPlayer(Twitch, this.idx);
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

  render() {
    if (!this.channels.length) return html``;
    const channel = this.channels[this.idx] ?? "";
    const min = this.minimized;
    // Twitch pauses the player when it's off-screen/clipped, so "minimized" can't fully
    // hide the video without pausing it. Instead minimized = a small but still-visible
    // corner thumbnail: the iframe stays in-viewport and keeps streaming, just smaller.
    // z above the footer (z-50) and content so it overlays everything.
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
          @pointercancel=${this.onDragUp}
        >
          <span class="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <span
              class="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500"
            ></span>
            <span class="shrink-0"
              >${translateText("featured_stream.live")}</span
            >
            <span class="truncate font-bold"
              >${this.streamTitle || channel}</span
            >
          </span>
          <button
            class="shrink-0 px-1 text-lg leading-none text-white/70 hover:text-white"
            aria-label=${translateText(
              min ? "featured_stream.expand" : "featured_stream.minimize",
            )}
            @click=${() => {
              this.minimized = !this.minimized;
              this.kickPlay(); // resume playback after the resize either way
            }}
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
