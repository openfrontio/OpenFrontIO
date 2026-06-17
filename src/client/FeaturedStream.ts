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
  @state() private dismissed = false;

  private channels: string[] = [];
  private idx = 0;
  private player?: TwitchPlayer;

  // Light DOM so Tailwind classes apply (matches HomepagePromos).
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.channels = ClientEnv.streamChannels();
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
    this.kickPlay();
  }

  // current channel offline -> try the next configured one; none left -> stay hidden
  private tryNext(Twitch: TwitchGlobal) {
    this.live = false;
    this.idx++;
    if (this.idx < this.channels.length) this.mountPlayer(Twitch, this.idx);
  }

  // Autoplay can be blocked while the panel is hidden; once it's visible, nudge playback.
  private kickPlay() {
    if (!this.visible()) return;
    void this.updateComplete.then(() => {
      try {
        this.player?.setMuted(true);
        this.player?.play();
      } catch {
        /* user can press play in the embed */
      }
    });
  }

  private visible(): boolean {
    return this.live && !this.inGame && !this.dismissed;
  }

  render() {
    if (!this.channels.length) return html``;
    const channel = this.channels[this.idx] ?? "";
    return html`
      <div
        class="fixed bottom-3 right-3 z-40 w-80 max-w-[90vw] overflow-hidden rounded-lg bg-black/90 shadow-2xl ring-1 ring-white/10 transition-opacity ${this.visible()
          ? "opacity-100"
          : "pointer-events-none opacity-0"}"
        aria-hidden=${this.visible() ? "false" : "true"}
      >
        <div class="flex items-center justify-between px-2 py-1 text-white">
          <span class="flex items-center gap-1 text-xs font-semibold">
            <span class="h-2 w-2 animate-pulse rounded-full bg-red-500"></span>
            ${translateText("featured_stream.live")}
            <a
              href="https://twitch.tv/${channel}"
              target="_blank"
              rel="noopener"
              class="ml-1 font-normal text-white/70 hover:text-white"
              >${channel}</a
            >
          </span>
          <button
            class="px-1 text-white/70 hover:text-white"
            aria-label=${translateText("featured_stream.close")}
            @click=${() => (this.dismissed = true)}
          >
            ✕
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
