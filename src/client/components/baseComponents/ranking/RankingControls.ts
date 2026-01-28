import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../../Utils";
import { RankType } from "./GameInfoRanking";

const economyRankings = new Set([
  RankType.TotalGold,
  RankType.StolenGold,
  RankType.ConqueredGold,
  RankType.NavalTrade,
  RankType.TrainTrade,
]);
const tradeRankings = new Set([RankType.NavalTrade, RankType.TrainTrade]);
const bombRankings = new Set([RankType.Atoms, RankType.Hydros, RankType.MIRV]);
const warRankings = new Set([
  RankType.Conquests,
  RankType.Atoms,
  RankType.Hydros,
  RankType.MIRV,
]);

const isEconomyRanking = (t: RankType) => economyRankings.has(t);
const isTradeRanking = (t: RankType) => tradeRankings.has(t);
const isBombRanking = (t: RankType) => bombRankings.has(t);
const isWarRanking = (t: RankType) => warRankings.has(t);

@customElement("ranking-controls")
export class RankingControls extends LitElement {
  @property({ type: String }) rankType = RankType.Lifetime;

  private onSort(type: RankType) {
    this.dispatchEvent(new CustomEvent("sort", { detail: type }));
  }

  private renderMainButtons() {
    return html`
      <div class="flex items-end justify-center p-6 pb-2 gap-5">
        ${this.renderButton(
          RankType.Lifetime,
          this.rankType === RankType.Lifetime,
          "game_info_modal.duration",
        )}
        ${this.renderButton(
          RankType.Conquests,
          isWarRanking(this.rankType),
          "game_info_modal.war",
        )}
        ${this.renderButton(
          RankType.TotalGold,
          isEconomyRanking(this.rankType),
          "game_info_modal.economy",
        )}
      </div>
    `;
  }

  private renderButton(type: RankType, active: boolean, label: string) {
    return html`
      <button
        class="px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest hover:text-white hover:bg-white/5 border ${active
          ? "bg-blue-500/20 text-blue-400 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
          : "text-white/40 border-transparent"}"
        @click=${() => this.onSort(type)}
      >
        ${translateText(label)}
      </button>
    `;
  }

  private renderWarSubranking() {
    if (!isWarRanking(this.rankType)) return "";

    return html`
      <div class="flex justify-center gap-3 pb-1">
        ${this.renderSubButton(
          RankType.MIRV,
          isBombRanking(this.rankType),
          "game_info_modal.bombs",
        )}
        ${this.renderSubButton(
          RankType.Conquests,
          this.rankType === RankType.Conquests,
          "game_info_modal.conquests",
        )}
      </div>
    `;
  }

  private renderEconomySubranking() {
    if (!isEconomyRanking(this.rankType)) return "";

    const econButtons = [
      [RankType.StolenGold, "game_info_modal.pirate"],
      [RankType.ConqueredGold, "game_info_modal.conquered"],
      [RankType.TotalGold, "game_info_modal.total_gold"],
    ];

    return html`
      <div class="flex justify-center gap-3 pb-1">
        ${this.renderSubButton(
          RankType.NavalTrade,
          isTradeRanking(this.rankType),
          "game_info_modal.trade",
        )}
        ${econButtons.map(([type, label]) =>
          this.renderSubButton(type as RankType, this.rankType === type, label),
        )}
      </div>
    `;
  }

  private renderSubButton(type: RankType, active: boolean, label: string) {
    return html`
      <button
        @click=${() => this.onSort(type)}
        class="text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 hover:bg-white/20 px-3 py-1 rounded text-white/60 hover:text-white transition-colors ${active
          ? "outline-1 outline-white/80 font-bold"
          : ""}"
      >
        ${translateText(label)}
      </button>
    `;
  }

  render() {
    return html`
      ${this.renderMainButtons()} ${this.renderWarSubranking()}
      ${this.renderEconomySubranking()}
    `;
  }

  createRenderRoot() {
    return this;
  }
}
