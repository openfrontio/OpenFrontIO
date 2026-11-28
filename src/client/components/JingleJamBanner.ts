import type { JingleJamFeed, LiveStream } from "@openfront/shared/ApiSchemas";
import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  formatGbp,
  JINGLE_JAM_OFF,
  jingleJamAllowedHere,
  jingleJamFeed,
  matchPercent,
} from "../JingleJamFeed";
import { watchUrl } from "../StreamsFeed";
import { translateText } from "../Utils";
import { formatViewers } from "./StreamingNow";

const MAX_STREAM_CARDS = 6;
// Only genuinely short screens drop the streams strip. The shared compact query also
// matches every phone and 768px-tall laptops, where the one-row strip still fits.
const SHORT_SCREEN_QUERY = "(max-height: 600px)";

// Festive edge along the top: OpenFront blue into gold into charity red, the same
// run as the match bar.
const EDGE =
  "h-[3px] w-full bg-[linear-gradient(90deg,#0084d1_0%,#ffd700_50%,#e5484d_100%)]";
// Navy panel with a soft gold glow behind the total and a faint red one at the Donate
// end, so it reads as a special panel without leaving the OpenFront palette.
const PANEL =
  "bg-surface bg-[radial-gradient(ellipse_at_0%_0%,rgba(255,215,0,0.12),transparent_55%),radial-gradient(ellipse_at_100%_100%,rgba(229,72,77,0.16),transparent_55%)]";

// The GOSH Charity logo tile. The real logo goes in here exactly as supplied, on its own
// white tile so it is never recoloured; until the files arrive it is the charity's name.
export function jingleJamLogo(size: "tall" | "sm"): TemplateResult {
  const box =
    size === "tall"
      ? "h-full min-h-12 w-14 lg:w-[88px] px-1.5 text-[10px] lg:text-[13px] rounded-lg"
      : "h-8 px-2 text-[10px] rounded whitespace-nowrap";
  return html`<div
    class="${box} shrink-0 bg-white text-surface flex items-center justify-center text-center font-extrabold leading-tight"
    role="img"
    aria-label="${translateText("jingle_jam.logo_alt")}"
  >
    ${translateText("jingle_jam.logo_alt")}
  </div>`;
}

// OpenFront's match, unlocked as donations come in: blue (OpenFront) into gold.
export function jingleJamBar(percent: number, thin = false): TemplateResult {
  return html`<div
    class="${
      thin ? "h-1.5" : "h-2.5"
    } w-full rounded-full bg-white/10 overflow-hidden ring-1 ring-inset ring-white/5"
  >
    <div
      class="h-full rounded-full bg-[linear-gradient(90deg,#0084d1,#3fa9f5_55%,#ffd700)] shadow-[0_0_10px_rgba(63,169,245,0.45)]"
      style="width:${percent.toFixed(1)}%"
    ></div>
  </div>`;
}

export function donateLink(
  url: string | undefined,
  size: "lg" | "sm",
): TemplateResult | typeof nothing {
  if (!url) return nothing;
  const cls =
    size === "lg"
      ? "h-10 px-4 text-sm lg:h-11 lg:px-6 lg:text-base rounded-lg bg-[#e5484d] hover:bg-[#f0595e] active:bg-[#d23c41] text-white"
      : "h-8 px-3 text-xs rounded-lg border border-red-400/60 text-red-300 hover:bg-red-500/10";
  return html`<a
    href="${url}"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="${translateText("jingle_jam.donate_aria")}"
    class="${cls} jj-donate inline-flex items-center justify-center gap-2 shrink-0 font-bold uppercase tracking-wider whitespace-nowrap no-underline transition-colors"
    ><svg
      viewBox="0 0 24 24"
      fill="currentColor"
      class="${size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"}"
      aria-hidden="true"
    >
      <path
        d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.1 0 3.6 1.1 4.4 2.5.8-1.4 2.3-2.5 4.4-2.5 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z"
      /></svg
    >${translateText("jingle_jam.donate")}</a
  >`;
}

// A zero cap means there is no match this year: no match bar, no "up to £0".
export function hasMatch(feed: JingleJamFeed): boolean {
  return (feed.totals?.matchCapPence ?? 0) > 0;
}

function copyLine(feed: JingleJamFeed): string {
  if (feed.copy === "default") {
    return feed.totals && hasMatch(feed)
      ? translateText("jingle_jam.copy_default", {
          cap: formatGbp(feed.totals.matchCapPence),
        })
      : translateText("jingle_jam.copy_default_nocap");
  }
  return translateText(`jingle_jam.copy_${feed.copy}`);
}

const charityLine = (belowLgOnly = false) =>
  html`<span
    class="ml-auto whitespace-nowrap text-[11px] text-white/45 ${
      belowLgOnly ? "lg:hidden" : ""
    }"
    >${translateText("jingle_jam.charity_line")}</span
  >`;

const label =
  "text-[10px] lg:text-[11px] font-bold uppercase tracking-[0.12em] leading-none";

const liveDot = html`<span class="relative flex h-2 w-2 shrink-0"
  ><span
    class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60"
  ></span
  ><span class="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span
></span>`;

// Homepage Jingle Jam (GOSH Charity) banner, at the top of the play page. Everything it
// shows comes from /jinglejam.json; the API decides the mode, so there is nothing to
// switch on or off here at midnight. Renders nothing while the feed is "off", on the
// portals and in the Steam shell.
@customElement("jj-banner")
export class JingleJamBanner extends LitElement {
  @state() private feed: JingleJamFeed = JINGLE_JAM_OFF;
  @state() private short = false;
  private unsubscribe: (() => void) | null = null;
  private shortQuery: MediaQueryList | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.syncHost();
    if (!jingleJamAllowedHere()) return;
    // Short screens keep the banner but drop the streams strip.
    this.shortQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia(SHORT_SCREEN_QUERY)
        : null;
    this.shortQuery?.addEventListener("change", this.onShort);
    this.short = this.shortQuery?.matches ?? false;
    this.unsubscribe = jingleJamFeed.subscribe((feed) => {
      this.feed = feed;
      this.syncHost();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.shortQuery?.removeEventListener("change", this.onShort);
    this.shortQuery = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onShort = (e: MediaQueryListEvent) => {
    this.short = e.matches;
  };

  // Collapse the host while off, so the play-page strip keeps its usual gap.
  private syncHost() {
    this.style.display = this.feed.mode === "off" ? "none" : "";
  }

  render() {
    const feed = this.feed;
    if (feed.mode === "off") return nothing;
    const ended = feed.mode === "ended";
    const streams = ended || this.short ? [] : this.streamsOf(feed);
    return html`
      <div
        class="${PANEL} relative overflow-hidden border-y border-white/10 sm:border sm:rounded-xl text-white"
        data-mode="${feed.mode}"
      >
        <div class="${EDGE}"></div>
        <div
          class="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.9)_1px,transparent_1.6px)] bg-[length:16px_16px] opacity-[0.05] [mask-image:radial-gradient(ellipse_at_100%_0%,black,transparent_60%)]"
          aria-hidden="true"
        ></div>
        <!-- Desktop: logo | headline over bar | Donate. Phones: logo | headline |
             Donate, with the bar and small print full width underneath. -->
        <div
          class="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 lg:gap-x-4 lg:gap-y-2.5 lg:px-4 lg:py-3"
        >
          <div class="flex self-stretch lg:row-span-2">
            ${jingleJamLogo("tall")}
          </div>
          <div class="min-w-0">${this.renderHead(feed)}</div>
          <div class="lg:row-span-2">
            ${ended ? nothing : donateLink(feed.donateUrl, "lg")}
          </div>
          <div class="col-span-3 min-w-0 lg:col-span-1 lg:col-start-2">
            ${this.renderFoot(feed)}
          </div>
        </div>
        ${!ended && feed.rewards.length > 0 ? this.renderRewards(feed) : nothing}
        ${streams.length > 0 ? this.renderStreams(feed, streams) : nothing}
      </div>
    `;
  }

  // Pinned stream first (the gold Featured card), then the rest by viewers.
  private streamsOf(feed: JingleJamFeed): LiveStream[] {
    const rest = feed.liveStreams.filter(
      (s) => !feed.pinned || s.channel !== feed.pinned.channel,
    );
    return [...(feed.pinned ? [feed.pinned] : []), ...rest].slice(
      0,
      MAX_STREAM_CARDS,
    );
  }

  // Event name (and the day's message), then the headline: the total and the match
  // while live, the fundraising line while static, the final total once ended.
  private renderHead(feed: JingleJamFeed) {
    const t = feed.totals;
    const ended = feed.mode === "ended";
    const live = feed.mode === "live" && t !== undefined;
    return html`
      <div class="flex min-w-0 items-baseline gap-3">
        <span class="${label} shrink-0 text-cyber-yellow"
          >${translateText(ended ? "jingle_jam.thanks" : "jingle_jam.eyebrow")}</span
        >
        ${html`<span
          class="ml-auto hidden lg:block min-w-0 truncate text-[11px] text-white/45"
          >${translateText("jingle_jam.charity_line")}</span
        >`}
      </div>
      ${
        t && (live || ended)
          ? html`<div class="mt-1.5 flex items-end justify-between gap-4">
              <div class="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
                ${
                  t.approx
                    ? html`<span class="text-xs text-white/60"
                        >${translateText("jingle_jam.approx")}</span
                      >`
                    : nothing
                }
                <span
                  class="jj-total text-[28px] lg:text-[36px] font-black tracking-tight leading-none tabular-nums text-cyber-yellow drop-shadow-[0_0_18px_rgba(255,215,0,0.3)]"
                  >${formatGbp(t.raisedPence)}</span
                >
                <span class="${label} text-white/55"
                  >${translateText(
                    ended ? "jingle_jam.raised_for" : "jingle_jam.raised",
                  )}</span
                >
              </div>
              ${
                live && hasMatch(feed)
                  ? html`<div class="hidden sm:block shrink-0 text-right">
                      <div class="${label} text-aquarius">
                        ${translateText("jingle_jam.match")}
                      </div>
                      <div class="mt-1 text-sm tabular-nums leading-none">
                        <b class="text-white">${formatGbp(t.matchPence)}</b>
                        <span class="text-white/45"
                          >/ ${formatGbp(t.matchCapPence)}</span
                        >
                      </div>
                    </div>`
                  : nothing
              }
            </div>`
          : html`<div
              class="mt-1 text-base lg:text-xl font-black leading-tight tracking-tight"
            >
              ${translateText(
                ended ? "jingle_jam.ended_line" : "jingle_jam.static_line",
              )}
            </div>`
      }
    `;
  }

  // Under the headline: the match bar and what it means while live, otherwise the
  // supporting line; the registered-charity line always ends the row.
  private renderFoot(feed: JingleJamFeed) {
    const t = feed.totals;
    if (feed.mode === "live" && t && hasMatch(feed)) {
      return html`
        ${jingleJamBar(matchPercent(t.matchPence, t.matchCapPence))}
        <div class="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
          <span class="min-w-0 truncate text-xs text-white/70 sm:hidden"
            >${translateText("jingle_jam.match_caption_short", {
              matched: formatGbp(t.matchPence),
              cap: formatGbp(t.matchCapPence),
            })}</span
          >${
            // Phones have no room beside the caption, so the day's message gets
            // its own line under it.
            feed.copy === "default"
              ? nothing
              : html`<span
                  class="jj-copy-phone basis-full min-w-0 text-xs font-semibold text-white/90 sm:hidden"
                  >${copyLine(feed)}</span
                >`
          }<span
            class="hidden sm:block min-w-0 truncate text-xs ${
              feed.copy === "default"
                ? "text-white/70"
                : "font-semibold text-white/90"
            }"
            >${
              feed.copy === "default"
                ? translateText("jingle_jam.match_caption", {
                    cap: formatGbp(t.matchCapPence),
                  })
                : copyLine(feed)
            }</span
          >${charityLine(true)}
        </div>
      `;
    }
    let lead: string | undefined;
    if (feed.mode === "ended" && t) {
      lead = hasMatch(feed)
        ? translateText("jingle_jam.thanks_line", {
            matched: formatGbp(t.matchPence),
          })
        : translateText("jingle_jam.thanks_line_nomatch");
    } else if (feed.mode !== "ended") {
      lead = copyLine(feed);
    }
    return html`<div class="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
      ${
        lead
          ? html`<span class="min-w-0 text-xs lg:text-sm text-white/70"
              >${lead}</span
            >`
          : nothing
      }${charityLine(true)}
    </div>`;
  }

  private renderStreams(feed: JingleJamFeed, streams: LiveStream[]) {
    return html`
      <div class="border-t border-white/10 bg-black/25">
        <div
          class="streaming-scroll flex items-center gap-2 overflow-x-auto px-3 py-2 pr-8 lg:px-4 lg:pr-10 [mask-image:linear-gradient(to_right,black_88%,transparent)]"
        >
          <span
            class="flex shrink-0 items-center gap-1.5 pr-1 text-[10px] lg:text-[11px] font-bold uppercase tracking-[0.12em] text-white/75"
            >${liveDot}<span class="hidden sm:inline whitespace-nowrap"
              >${translateText("jingle_jam.streams_title")}</span
            ></span
          >
          ${streams.map((s) =>
            this.renderCard(s, feed.pinned?.channel === s.channel),
          )}
        </div>
      </div>
    `;
  }

  private renderCard(s: LiveStream, featured: boolean) {
    const initial = s.displayName.charAt(0).toUpperCase();
    return html`<a
      href="${watchUrl(s)}"
      target="_blank"
      rel="noopener noreferrer"
      title="${s.title ?? nothing}"
      aria-label="${translateText("jingle_jam.watch", { name: s.displayName })}"
      class="jj-stream group flex shrink-0 items-center gap-2 rounded-lg border py-1 pl-1 pr-3 no-underline text-white transition-colors ${
        featured
          ? "border-cyber-yellow/60 bg-cyber-yellow/10 hover:bg-cyber-yellow/15"
          : "border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.08]"
      }"
    >
      <span class="relative shrink-0">
        ${
          s.avatarUrl
            ? html`<img
                src="${s.avatarUrl}"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                class="h-8 w-8 rounded-md object-cover"
              />`
            : html`<span
                class="flex h-8 w-8 items-center justify-center rounded-md bg-[#9146FF]/80 text-sm font-bold"
                aria-hidden="true"
                >${initial}</span
              >`
        }
      </span>
      <span class="min-w-0 leading-tight">
        <span class="flex items-center gap-1.5">
          ${
            featured
              ? html`<span
                  class="rounded-sm bg-cyber-yellow px-1 text-[9px] font-black uppercase tracking-wider text-surface"
                  >${translateText("jingle_jam.featured")}</span
                >`
              : nothing
          }
          <b class="max-w-[140px] truncate text-[13px] font-semibold"
            >${s.displayName}</b
          >
        </span>
        <span class="flex items-center gap-1 text-[11px] text-white/55"
          ><svg
            viewBox="0 0 24 24"
            fill="currentColor"
            class="h-3 w-3"
            aria-hidden="true"
          >
            <path
              d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"
            /></svg
          >${translateText("jingle_jam.viewers", {
            count: formatViewers(s.viewers),
          })}</span
        >
      </span>
    </a>`;
  }

  // The Tiltify rewards (the Punish Lewis menu on 5 Dec), shown only when an admin
  // turns them on. Names come from Tiltify as written. Each one opens Donate, so the
  // menu is something to act on rather than a price list.
  private renderRewards(feed: JingleJamFeed) {
    const chip =
      "flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] py-1 pl-1 pr-2 text-xs no-underline text-white/85";
    return html`
      <div class="border-t border-cyber-yellow/20 bg-cyber-yellow/[0.04]">
        <div class="flex flex-wrap items-center gap-2 px-3 py-2 lg:px-4">
          <span
            class="pr-1 text-[10px] lg:text-[11px] font-bold uppercase tracking-[0.12em] text-cyber-yellow"
            >${translateText("jingle_jam.punishment_menu")}</span
          >
          ${feed.rewards.map((r) => {
            const body = html`<b
                class="rounded border border-cyber-yellow/60 px-1 font-bold tabular-nums text-cyber-yellow"
                >${formatGbp(r.amountPence)}</b
              ><span>${r.name}</span>`;
            return feed.donateUrl
              ? html`<a
                  href="${feed.donateUrl}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="${chip} transition-colors hover:border-cyber-yellow/50 hover:bg-cyber-yellow/10"
                  >${body}</a
                >`
              : html`<span class="${chip}">${body}</span>`;
          })}
        </div>
      </div>
    `;
  }
}
