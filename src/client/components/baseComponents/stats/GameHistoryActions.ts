import { html, type TemplateResult } from "lit";
import { assetUrl } from "../../../../core/AssetUrls";
import { translateText } from "../../../Utils";

const statsIcon = assetUrl("images/LeaderboardIconRegularWhite.svg");
const replayIcon = assetUrl("images/ReplayRegularIconWhite.svg");

export function renderGameHistoryActions(
  showStats: () => void,
  watchReplay: () => void,
): TemplateResult {
  const statsLabel = translateText("game_list.stats");
  const replayLabel = translateText("clan_modal.history_watch_replay");

  return html`
    <div class="flex items-center gap-2 shrink-0">
      <button
        type="button"
        title=${statsLabel}
        aria-label=${statsLabel}
        @click=${showStats}
        class="inline-flex w-8 h-8 items-center justify-center text-white/80 bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg transition-colors"
      >
        <img
          src=${statsIcon}
          alt=""
          aria-hidden="true"
          width="18"
          height="18"
        />
        <span class="sr-only">${statsLabel}</span>
      </button>
      <button
        type="button"
        title=${replayLabel}
        aria-label=${replayLabel}
        @click=${watchReplay}
        class="inline-flex w-8 h-8 items-center justify-center text-white bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 rounded-lg transition-all"
      >
        <img
          src=${replayIcon}
          alt=""
          aria-hidden="true"
          width="18"
          height="18"
        />
        <span class="sr-only">${replayLabel}</span>
      </button>
    </div>
  `;
}
