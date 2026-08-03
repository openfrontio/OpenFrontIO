import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LiveStream } from "../../core/ApiSchemas";
import { streamsFeed, watchUrl } from "../StreamsFeed";
import { translateText } from "../Utils";

// Compact viewer count: 932 -> "932", 1234 -> "1.2K", 12345 -> "12K", 1.2e6 -> "1.2M".
export function formatViewers(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    if (k >= 999.5) return "1.0M"; // avoid "1000K" when rounding crosses a million
    return `${k.toFixed(k < 9.95 ? 1 : 0)}K`;
  }
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// Homepage "Streaming Now" panel: a fixed-size bubble showing who is live playing
// OpenFront, fed by the shared streams feed. Every entry has been verified live
// server-side (Twitch via Helix, YouTube via videos.list), so nothing here decides
// liveness or fetches from a platform to find out. Streamers are compact cards in a
// horizontal slider, so the bubble never grows with the count. Stays hidden until there
// is a live stream, so the sibling news box keeps the full row when nobody is live.
@customElement("streaming-now")
export class StreamingNow extends LitElement {
  @state() private streams: LiveStream[] = [];
  private unsubscribe: (() => void) | null = null;

  // Light DOM so Tailwind classes apply (matches NewsBox).
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.display = "none"; // hidden until the feed reports a live stream (no flash)
    // Desktop only (host carries `hidden lg:block`); below lg, don't even subscribe.
    if (
      typeof window.matchMedia === "function" &&
      !window.matchMedia("(min-width: 1024px)").matches
    ) {
      return;
    }
    // The shared poller owns the cadence and stops itself in-game and while the tab is
    // hidden. This previously ran its own setInterval and only cleared it in
    // disconnectedCallback — which never fires, because <play-page> is never removed
    // from the DOM — so it polled for the entire session, games included.
    this.unsubscribe = streamsFeed.subscribe((feed) => {
      // Highest viewer counts first (defensive; the API already sorts).
      this.streams = [...feed.live].sort((a, b) => b.viewers - a.viewers);
      // Collapse the host when nobody is live; .streaming-live lets the play-page strip
      // switch to its 2-column grid (via has-[]) only while the panel is actually shown.
      const live = this.streams.length > 0;
      this.style.display = live ? "" : "none";
      this.classList.toggle("streaming-live", live);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  render() {
    if (this.streams.length === 0) return nothing;
    const count = translateText("streaming_now.live_count", {
      count: this.streams.length,
    });
    return html`
      <style>
        .streaming-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
        }
        .streaming-scroll::-webkit-scrollbar {
          height: 6px;
        }
        .streaming-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.25);
          border-radius: 9999px;
        }
        .streaming-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
        }
      </style>
      <div
        class="flex flex-col bg-surface px-2 py-2 border-y border-white/10 sm:h-full sm:flex-1 sm:justify-center sm:border-y-0 sm:rounded-xl sm:px-3 sm:py-2"
      >
        <div class="mb-2 flex items-center gap-2">
          <span class="h-2 w-2 animate-pulse rounded-full bg-red-500"></span>
          <span
            class="text-xs font-bold uppercase tracking-wider text-white/70"
          >
            ${translateText("streaming_now.title")}
          </span>
          <span
            class="ml-auto text-[11px] text-white/40"
            title="${count}"
            aria-label="${count}"
            >${count}</span
          >
        </div>
        <div class="streaming-scroll flex snap-x gap-3 overflow-x-auto py-1.5">
          ${this.streams.map((s) => this.renderCard(s))}
        </div>
      </div>
    `;
  }

  private renderCard(s: LiveStream) {
    return html`
      <a
        href="${watchUrl(s)}"
        target="_blank"
        rel="noopener noreferrer"
        title="${s.title ?? nothing}"
        aria-label="${translateText("streaming_now.watch", {
          name: s.displayName,
        })}"
        class="group flex w-20 shrink-0 snap-start flex-col items-center gap-1 text-center"
      >
        <div class="relative">
          ${s.avatarUrl
            ? html`<img
                src="${s.avatarUrl}"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                class="h-11 w-11 rounded-full object-cover ring-2 ring-red-500/70"
              />`
            : html`<div
                class="h-11 w-11 rounded-full bg-white/10 ring-2 ring-red-500/70"
              ></div>`}
          <span
            class="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface"
          >
            ${this.platformIcon(s.platform)}
          </span>
        </div>
        <div
          class="w-full truncate text-[11px] font-medium text-white transition-colors group-hover:text-blue-300"
        >
          ${s.displayName}
        </div>
        <div class="w-full truncate text-[10px] text-white/50">
          ${translateText("streaming_now.viewers", {
            count: formatViewers(s.viewers),
          })}
        </div>
      </a>
    `;
  }

  private platformIcon(platform: LiveStream["platform"]) {
    const cls = "h-2.5 w-2.5";
    if (platform === "youtube") {
      return html`<svg
        viewBox="0 0 24 24"
        fill="currentColor"
        class="${cls} text-red-500"
      >
        <path
          d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
        />
      </svg>`;
    }
    return html`<svg
      viewBox="0 0 24 24"
      fill="currentColor"
      class="${cls} text-[#9146FF]"
    >
      <path
        d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"
      />
    </svg>`;
  }
}
