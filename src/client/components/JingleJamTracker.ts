import type { JingleJamFeed } from "@openfront/shared/ApiSchemas";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  formatGbp,
  JINGLE_JAM_OFF,
  jingleJamAllowedHere,
  jingleJamFeed,
  matchPercent,
} from "../JingleJamFeed";
import { translateText } from "../Utils";
import { donateLink, jingleJamBar, jingleJamLogo } from "./JingleJamBanner";

// One compact row at the top of the join and host lobby modals: the total, the match
// bar and Donate. It reads the same poller as the homepage banner, which keeps going
// through the lobby wait and stops when the game starts.
@customElement("jj-tracker")
export class JingleJamTracker extends LitElement {
  @state() private feed: JingleJamFeed = JINGLE_JAM_OFF;
  private unsubscribe: (() => void) | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.syncHost();
    if (!jingleJamAllowedHere()) return;
    this.unsubscribe = jingleJamFeed.subscribe((feed) => {
      this.feed = feed;
      this.syncHost();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // No box at all while off, so the modal's spacing is unchanged.
  private syncHost() {
    this.style.display = this.feed.mode === "off" ? "none" : "block";
  }

  render() {
    const feed = this.feed;
    if (feed.mode === "off") return nothing;
    const t = feed.totals;
    let body;
    if (feed.mode === "ended") {
      body = html`<div class="text-[12.5px] text-white">
        ${
          t
            ? translateText("jingle_jam.thanks_short", {
                amount: formatGbp(t.raisedPence),
              })
            : translateText("jingle_jam.thanks")
        }
      </div>`;
    } else if (feed.mode === "live" && t) {
      body = html`<div class="text-[12.5px] leading-tight">
          ${
            t.approx
              ? html`<span class="text-white/60"
                  >${translateText("jingle_jam.approx")}</span
                >`
              : nothing
          }
          <b class="text-white text-sm font-black tabular-nums"
            >${formatGbp(t.raisedPence)}</b
          >
          <span class="text-white/65"
            >${translateText("jingle_jam.raised_for")}</span
          >
        </div>
        <div class="mt-1 flex items-center gap-2">
          <div class="min-w-0 flex-1">
            ${jingleJamBar(matchPercent(t.matchPence, t.matchCapPence), true)}
          </div>
          <span class="shrink-0 text-[11px] tabular-nums text-white/60"
            >${translateText("jingle_jam.matched_short", {
              matched: formatGbp(t.matchPence),
              cap: formatGbp(t.matchCapPence),
            })}</span
          >
        </div>`;
    } else {
      body = html`<div class="text-[12.5px] text-white">
        ${translateText("jingle_jam.tracker_static")}
      </div>`;
    }
    return html`<div
      class="flex min-h-12 items-center gap-3 rounded-xl border border-white/10 border-l-[3px] border-l-cyber-yellow bg-white/[0.03] px-3 py-2"
      data-mode="${feed.mode}"
    >
      ${jingleJamLogo("sm")}
      <div class="min-w-0 flex-1">${body}</div>
      ${feed.mode === "ended" ? nothing : donateLink(feed.donateUrl, "sm")}
    </div>`;
  }
}
