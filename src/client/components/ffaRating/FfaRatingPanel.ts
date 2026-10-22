import type { FfaGameRatingResponse } from "@openfront/shared/ApiSchemas";
import { LitElement, TemplateResult, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { pollFfaGameRating } from "../../FfaRatingApi";
import { translateText } from "../../Utils";
import {
  ffaTierLabelOf,
  ffaTierRank,
  formatExpectedPct,
  formatRatingChange,
  formatRatingWithUncertainty,
} from "./FfaTier";
import "./FfaTierBadge";
import "./OfstatsCredit";

/** The smallest lobby (humans) whose FFA games are rated. */
export const FFA_RATING_MIN_HUMANS = 10;

export type FfaRatingPanelView =
  | { kind: "hidden" }
  | { kind: "pending" }
  | { kind: "calibrating"; calibrationGames: number }
  | {
      kind: "revealed";
      ratingAfter: number;
      uncertaintyAfter: number;
      tierAfter: string;
    }
  | {
      kind: "result";
      result: Required<Omit<FfaGameRatingResponse, "revealed">>;
    };

/** What the panel shows for a polled response (null: nothing to show). */
export function ffaRatingPanelView(
  data: FfaGameRatingResponse | null,
): FfaRatingPanelView {
  if (data === null) return { kind: "hidden" };
  if (data.calibrating) {
    return { kind: "calibrating", calibrationGames: data.calibrationGames };
  }
  const {
    ratingBefore,
    ratingAfter,
    uncertaintyAfter,
    tierBefore,
    tierAfter,
    expected,
    deltaResult,
    deltaPlace,
  } = data;
  // The game that completes calibration: the earlier rating was never shown,
  // so there is no change to report.
  if (
    data.revealed === true &&
    ratingAfter !== undefined &&
    uncertaintyAfter !== undefined &&
    tierAfter !== undefined
  ) {
    return { kind: "revealed", ratingAfter, uncertaintyAfter, tierAfter };
  }
  if (
    ratingBefore === undefined ||
    ratingAfter === undefined ||
    uncertaintyAfter === undefined ||
    tierBefore === undefined ||
    tierAfter === undefined ||
    expected === undefined ||
    deltaResult === undefined ||
    deltaPlace === undefined
  ) {
    return { kind: "hidden" };
  }
  return {
    kind: "result",
    result: {
      gameId: data.gameId,
      calibrating: data.calibrating,
      calibrationGames: data.calibrationGames,
      ratingBefore,
      ratingAfter,
      uncertaintyAfter,
      tierBefore,
      tierAfter,
      expected,
      deltaResult,
      deltaPlace,
    },
  };
}

const STYLE_ID = "ffa-rating-panel-styles";

const FFA_RATING_PANEL_CSS = /* css */ `
@keyframes ffa-tier-up-in {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: no-preference) {
  .ffa-tier-up {
    animation: ffa-tier-up-in 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) 1 both;
  }
}
`;

// Once per document, in <head>, like ProfileCard's styles.
function ensureFfaRatingPanelStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = FFA_RATING_PANEL_CSS;
  document.head.appendChild(style);
}

function changeColor(n: number): string {
  const r = Math.round(n);
  return r > 0 ? "text-green-400" : r < 0 ? "text-red-400" : "text-white/50";
}

/**
 * The win screen's FFA rating: the new rating and tier, the change split into
 * result and placement, the pre-game win chance, and a promotion line. Asks
 * the API once for a lobby big enough to be rated; shows nothing at all when
 * there is no rating to show.
 */
@customElement("ffa-rating-panel")
export class FfaRatingPanel extends LitElement {
  @property({ type: String }) gameId = "";
  @property({ type: Number }) lobbyHumans = 0;
  // Replaceable for tests and screenshots.
  @property({ attribute: false }) poll: (
    gameId: string,
    signal: AbortSignal,
  ) => Promise<FfaGameRatingResponse | null> = (id, signal) =>
    pollFfaGameRating(id, { signal });

  private view: FfaRatingPanelView = { kind: "hidden" };
  private polledGameId: string | null = null;
  private abort: AbortController | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Lit schedules no update on re-attach, so ask for one: updated() then
    // polls again.
    if (this.hasUpdated) this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.abort?.abort();
    this.abort = null;
    // A re-attached panel asks again (connectedCallback requests the update).
    this.polledGameId = null;
  }

  protected updated() {
    if (
      !this.isConnected ||
      this.gameId === "" ||
      this.lobbyHumans < FFA_RATING_MIN_HUMANS ||
      this.polledGameId === this.gameId
    ) {
      return;
    }
    ensureFfaRatingPanelStyles();
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.polledGameId = this.gameId;
    this.view = { kind: "pending" };
    this.requestUpdate();
    void this.poll(this.gameId, abort.signal).then(
      (data) => this.settle(abort, ffaRatingPanelView(data)),
      () => this.settle(abort, { kind: "hidden" }),
    );
  }

  private settle(abort: AbortController, view: FfaRatingPanelView) {
    if (abort.signal.aborted) return;
    this.view = view;
    this.requestUpdate();
  }

  render() {
    const view = this.view;
    switch (view.kind) {
      case "hidden":
        return nothing;
      case "pending":
        return this.section(
          "pending",
          html`<p class="text-sm text-white/70">
            ${translateText("ffa_rating.pending")}
          </p>`,
        );
      case "calibrating":
        return this.section(
          "calibrating",
          html`<ffa-tier-badge
              size="md"
              .calibrationGames=${view.calibrationGames}
            ></ffa-tier-badge>
            <ofstats-credit></ofstats-credit>`,
        );
      case "revealed":
        return this.section(
          "revealed",
          html`<p data-ffa-calibration-complete class="text-sm text-white/70">
              ${translateText("ffa_rating.calibration_complete")}
            </p>
            <div class="flex items-center gap-2">
              <ffa-tier-badge
                size="md"
                .tier=${view.tierAfter}
              ></ffa-tier-badge>
              <span
                data-ffa-rating-after
                class="text-lg font-bold tabular-nums text-white"
                >${formatRatingWithUncertainty(
                  view.ratingAfter,
                  view.uncertaintyAfter,
                )}</span
              >
            </div>
            <ofstats-credit></ofstats-credit>`,
        );
      case "result":
        return this.section("result", this.renderResult(view.result));
    }
  }

  private section(kind: string, body: TemplateResult) {
    return html`<section
      data-ffa-rating-panel=${kind}
      class="flex flex-col gap-1.5 mb-3 text-center items-center"
    >
      <h3 class="text-xs font-bold uppercase tracking-wide text-white/70">
        ${translateText("ffa_rating.title")}
      </h3>
      ${body}
    </section>`;
  }

  private renderResult(r: Required<Omit<FfaGameRatingResponse, "revealed">>) {
    const change = r.ratingAfter - r.ratingBefore;
    const rankBefore = ffaTierRank(r.tierBefore);
    const rankAfter = ffaTierRank(r.tierAfter);
    const promoted =
      rankBefore !== null && rankAfter !== null && rankAfter > rankBefore;
    return html`<div class="flex items-center gap-2">
        <ffa-tier-badge size="md" .tier=${r.tierAfter}></ffa-tier-badge>
        <span
          data-ffa-rating-after
          class="text-lg font-bold tabular-nums text-white"
          >${formatRatingWithUncertainty(
            r.ratingAfter,
            r.uncertaintyAfter,
          )}</span
        >
        <span
          data-ffa-rating-change
          class="text-sm font-bold tabular-nums ${changeColor(change)}"
          >${formatRatingChange(change)}</span
        >
      </div>
      <span data-ffa-rating-expected class="text-xs text-white/70"
        >${translateText("ffa_rating.expected", {
          pct: formatExpectedPct(r.expected),
        })}</span
      >
      <div class="flex gap-4 text-xs text-white/70">
        <div data-ffa-rating-result>
          ${translateText("ffa_rating.result")}
          <span class="font-bold tabular-nums ${changeColor(r.deltaResult)}"
            >${formatRatingChange(r.deltaResult)}</span
          >
        </div>
        <div data-ffa-rating-placement>
          ${translateText("ffa_rating.placement")}
          <span class="font-bold tabular-nums ${changeColor(r.deltaPlace)}"
            >${formatRatingChange(r.deltaPlace)}</span
          >
        </div>
      </div>
      ${promoted
        ? html`<p
            data-ffa-tier-up
            class="ffa-tier-up text-sm font-bold text-yellow-400"
          >
            ${translateText("ffa_rating.tier_up", {
              tier: ffaTierLabelOf(r.tierAfter),
            })}
          </p>`
        : nothing}
      <ofstats-credit></ofstats-credit>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ffa-rating-panel": FfaRatingPanel;
  }
}
