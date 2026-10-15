/**
 * <replay-status>: the centred panel the replay viewer shows while it
 * loads or processes a game, or when it can't show one, with an exit
 * button in the corner.
 */

import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../components/baseComponents/Button";
import { translateText } from "../Utils";
import { exitButton } from "./ReplayControls";
import { classicReplayHref } from "./ReplayEntry";

/** Progress shown until the first frames arrive. */
export interface Preparing {
  phase: "fetching" | "simulating";
  percent: number;
}

@customElement("replay-status")
export class ReplayStatus extends LitElement {
  @property() gameID = "";
  @property() status: "loading" | "processing" | "error" = "loading";
  @property({ attribute: false }) progress: Preparing = {
    phase: "fetching",
    percent: 0,
  };
  @property() error = "";
  /** Whether to offer the old client-side replay. */
  @property({ type: Boolean }) classicFallback = false;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        class="absolute inset-0 flex items-center justify-center p-4 pointer-events-none"
      >
        <div
          class="pointer-events-auto w-full max-w-sm flex flex-col items-center gap-4 p-6 rounded-2xl border border-white/10 bg-black/70 backdrop-blur-xl shadow-2xl text-center text-white"
        >
          ${this.status === "loading"
            ? html`${spinner()}
                <h2 class="text-lg font-bold text-white">
                  ${translateText("replay_viewer.loading")}
                </h2>`
            : nothing}
          ${this.status === "processing" ? this.renderProgress() : nothing}
          ${this.status === "error" ? this.renderError() : nothing}
          ${this.classicFallback
            ? html`<div class="w-full flex flex-col gap-2 pt-2">
                <o-button
                  width="block"
                  size="sm"
                  translationKey="replay_viewer.watch_classic"
                  @click=${() =>
                    window.location.assign(classicReplayHref(this.gameID))}
                ></o-button>
              </div>`
            : nothing}
        </div>
      </div>
      <div
        class="absolute bottom-0 right-0 p-2 bg-gray-800/92 backdrop-blur-sm rounded-tl-lg"
      >
        ${exitButton()}
      </div>
    `;
  }

  private renderProgress() {
    const { phase: step, percent } = this.progress;
    const phase =
      step === "fetching"
        ? translateText("replay_viewer.processing_fetching")
        : translateText("replay_viewer.processing_simulating", {
            percent: String(Math.round(percent)),
          });
    return html`
      ${spinner()}
      <h2 class="text-lg font-bold text-white">
        ${translateText("replay_viewer.processing")}
      </h2>
      <div class="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          class="h-full rounded-full bg-malibu-blue shadow-malibu-blue-pill transition-[width] duration-500 ease-out"
          style=${`width: ${step === "simulating" ? percent : 0}%`}
        ></div>
      </div>
      <p class="text-sm text-white/60 tabular-nums">${phase}</p>
    `;
  }

  private renderError() {
    return html`
      <div
        class="w-14 h-14 rounded-full border border-red-500/50 bg-red-500/10 flex items-center justify-center text-2xl font-bold text-red-300"
        aria-hidden="true"
      >
        !
      </div>
      <p role="alert" class="text-sm font-medium text-red-300">${this.error}</p>
    `;
  }
}

/** Spinner, same as the lobby's. */
function spinner() {
  return html`
    <div
      class="w-14 h-14 rounded-full border border-malibu-blue/40 bg-malibu-blue/10 flex items-center justify-center"
    >
      <div
        class="w-7 h-7 border-[3px] border-white/20 border-t-white rounded-full animate-spin"
      ></div>
    </div>
  `;
}
