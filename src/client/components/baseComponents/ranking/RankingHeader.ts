import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../../Utils";
import { RankType } from "./GameInfoRanking";

@customElement("ranking-header")
export class RankingHeader extends LitElement {
  @property({ type: String }) rankType = RankType.Lifetime;

  private onSort(type: RankType) {
    this.dispatchEvent(new CustomEvent("sort", { detail: type }));
  }

  render() {
    return html`
      <li
        class="text-lg bg-gray-800 font-bold relative pt-2 pb-2 pr-5 pl-5 mb-1.25 rounded-md flex justify-between items-center"
      >
        ${this.renderHeaderContent()}
      </li>
    `;
  }

  private renderHeaderContent() {
    switch (this.rankType) {
      case RankType.Lifetime:
        return html`<div class="w-full">
          ${translateText("game_info_modal.survival_time")}
        </div>`;
      case RankType.Conquests:
        return html`<div class="w-full">
          ${translateText("game_info_modal.num_of_conquests")}
        </div>`;
      case RankType.Atoms:
      case RankType.Hydros:
      case RankType.MIRV:
        return html`
          <div class="flex justify-between sm:px-17.5 w-full">
            ${this.renderMultipleChoiceHeaderButton(
              translateText("game_info_modal.atoms"),
              RankType.Atoms,
            )}
            /
            ${this.renderMultipleChoiceHeaderButton(
              translateText("game_info_modal.hydros"),
              RankType.Hydros,
            )}
            /
            ${this.renderMultipleChoiceHeaderButton(
              translateText("game_info_modal.mirv"),
              RankType.MIRV,
            )}
          </div>
        `;
      case RankType.TotalGold:
        return html`<div class="w-full">
          ${translateText("game_info_modal.all_gold")}
        </div>`;
      case RankType.NavalTrade:
      case RankType.TrainTrade:
        return html`
          <div class="flex justify-between sm:px-17.5 w-full">
            ${this.renderMultipleChoiceHeaderButton("🚂", RankType.TrainTrade)}
            /
            ${this.renderMultipleChoiceHeaderButton("🚢", RankType.NavalTrade)}
          </div>
        `;
      case RankType.ConqueredGold:
        return html`<div class="w-full">
          ${translateText("game_info_modal.conquest_gold")}
        </div>`;
      case RankType.StolenGold:
        return html`<div class="w-full">
          ${translateText("game_info_modal.stolen_gold")}
        </div>`;
      default:
        console.warn("Unhandled RankType", this.rankType);
        return null;
    }
  }

  private renderMultipleChoiceHeaderButton(label: string, type: RankType) {
    return html`
      <button
        @click=${() => this.onSort(type)}
        class="${this.rankType === type
          ? "border-b-2 border-b-white"
          : nothing} h-[28px]"
      >
        ${label}
      </button>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
