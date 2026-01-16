import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  GOLD_INDEX_TRADE,
  GOLD_INDEX_TRAIN_OTHER,
  GOLD_INDEX_TRAIN_SELF,
} from "src/core/StatsSchemas";
import { renderNumber } from "../../../Utils";
import { PlayerInfo, RankType } from "./GameInfoRanking";

@customElement("player-row")
export class PlayerRow extends LitElement {
  @property({ type: Object }) player: PlayerInfo;
  @property({ type: String }) rankType: RankType;
  @property({ type: Number }) bestScore = 1;
  @property({ type: Number }) rank = 1;
  @property({ type: Number }) score = 0;
  @property({ type: Boolean }) currentPlayer = false;

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.player) return html``;
    const { player } = this;
    const visibleBorder = player.winner || this.currentPlayer;
    return html`
      <li
        class="${player.winner
          ? "bg-linear-to-r via-none from-sky-400 to-blue-700"
          : "bg-slate-700"} border-2
          ${player.winner
          ? "border-yellow-500"
          : visibleBorder
            ? "border-yellow-50"
            : "border-yellow-50/0"}
          relative pt-1 pb-1 pr-2 pl-2 sm:pl-5 sm:pr-5 mb-1.25 rounded-lg flex justify-between items-center hover:bg-slate-500 transition duration-150 ease-in-out"
      >
        <div
          class="font-bold text-right w-7.5 text-lg text-white absolute -left-10"
        >
          ${this.rank}
        </div>
        ${this.renderPlayerInfo()}
      </li>
    `;
  }

  private renderPlayerIcon() {
    return html`
      ${this.renderIcon()} ${this.player.winner ? this.renderCrownIcon() : ""}
    `;
  }

  private renderCrownIcon() {
    return html`
      <img
        src="/images/CrownIcon.svg"
        class="absolute -top-0.75 left-4 size-3.75 sm:-top-1.75 sm:left-7.5 sm:size-5"
      />
    `;
  }

  private renderPlayerInfo() {
    switch (this.rankType) {
      case RankType.Lifetime:
      case RankType.Conquests:
        return this.renderScoreAsBar();
      case RankType.Atoms:
      case RankType.Hydros:
      case RankType.MIRV:
        return this.renderBombScore();
      case RankType.TotalGold:
      case RankType.ConqueredGold:
      case RankType.StolenGold:
        return this.renderGoldScore();
      case RankType.NavalTrade:
      case RankType.TrainTrade:
        return this.renderTradeScore();
      default:
        return html``;
    }
  }

  private renderScoreAsBar() {
    return html`
      <div class="flex gap-3 items-center w-full">
        ${this.renderPlayerIcon()}
        <div class="flex flex-col sm:flex-row gap-1 text-left w-full">
          ${this.renderPlayerName()} ${this.renderScoreBar()}
        </div>
      </div>
      <div>
        <div
          class="font-bold rounded-[50%] size-7.5 leading-[1.6rem] border border-gray-200 text-center bg-white text-black"
        >
          ${Number(this.score).toFixed(0)}
        </div>
      </div>
    `;
  }

  private renderScoreBar() {
    const bestScore = Math.max(this.bestScore, 1);
    const width = Math.min(Math.max((this.score / bestScore) * 100, 0), 100);
    return html`
      <div class="w-full pr-2.5 m-auto">
        <div class="h-1.75 bg-neutral-800 w-full">
          <!-- bar background -->
          <div
            class="h-1.75 bg-white w-(--width)"
            style="--width: ${width}%;"
          ></div>
        </div>
      </div>
    `;
  }

  private renderMultiScoreType(value: number, highlight: boolean) {
    return html`
      <div
        class="${highlight
          ? "font-bold text-[18px]"
          : "leading-[24px]"} min-w-7.5 sm:min-w-15 inline-block text-center"
      >
        ${renderNumber(value)}
      </div>
    `;
  }

  private renderAllBombs() {
    return html`
      <div class="flex justify-between text-sm sm:pr-20">
        ${this.renderMultiScoreType(
          this.player.atoms,
          this.rankType === RankType.Atoms,
        )}
        /
        ${this.renderMultiScoreType(
          this.player.hydros,
          this.rankType === RankType.Hydros,
        )}
        /
        ${this.renderMultiScoreType(
          this.player.mirv,
          this.rankType === RankType.MIRV,
        )}
      </div>
    `;
  }

  private renderAllTrades() {
    const navalTrade = this.player.gold[GOLD_INDEX_TRADE] ?? 0n;
    const ownTrainTrade = this.player.gold[GOLD_INDEX_TRAIN_SELF] ?? 0n;
    const otherTrainTrade = this.player.gold[GOLD_INDEX_TRAIN_OTHER] ?? 0n;
    return html`
      <div class="flex justify-between text-sm align-baseline">
        ${this.renderMultiScoreType(
          Number(navalTrade),
          this.rankType === RankType.NavalTrade,
        )}
        /
        ${this.renderMultiScoreType(
          Number(ownTrainTrade + otherTrainTrade),
          this.rankType === RankType.TrainTrade,
        )}
      </div>
    `;
  }

  private renderBombScore() {
    return html`
      <div class="flex gap-3 items-center align-baseline w-full">
        ${this.renderPlayerIcon()}
        <div class="flex flex-col sm:flex-row gap-1 text-left w-full">
          ${this.renderPlayerName()} ${this.renderAllBombs()}
        </div>
      </div>
    `;
  }

  private renderGoldScore() {
    return html`
      <div class="flex gap-3 items-center">
        ${this.renderPlayerIcon()}
        <div class="text-left w-31.25 sm:w-50">${this.renderPlayerName()}</div>
      </div>

      <div class="flex gap-2">
        <div
          class="font-bold rounded-md w-15 shrink-0 text-sm sm:w-25 leading-[1.9rem] text-center"
        >
          ${renderNumber(this.score)}
        </div>
        <img src="/images/GoldCoinIcon.svg" class="size-3.5 sm:size-5 m-auto" />
      </div>
    `;
  }

  private renderTradeScore() {
    return html`
      <div class="flex gap-3 items-center">
        ${this.renderPlayerIcon()}
        <div class="text-left w-31.25 sm:w-50">${this.renderPlayerName()}</div>
      </div>

      <div class="flex gap-2 w-50 justify-between items-center">
        <div
          class="font-bold rounded-md w-15 shrink-0 text-sm sm:w-25 leading-[1.9rem] text-center"
        >
          ${this.renderAllTrades()}
        </div>
        <img src="/images/GoldCoinIcon.svg" class="w-5 size-3.5 sm:size-5" />
      </div>
    `;
  }

  private renderPlayerName() {
    return html`
      <div class="flex gap-1 items-center w-50 shrink-0">
        ${this.player.tag ? this.renderTag(this.player.tag) : ""}
        <div
          class="text-xs sm:text-sm font-bold text-ellipsis w-37.5 shrink-0 overflow-hidden whitespace-nowrap"
        >
          ${this.player.username}
        </div>
      </div>
    `;
  }

  private renderTag(tag: string) {
    return html`
      <div
        class="bg-white text-black rounded-lg sm:rounded-xl border border-gray-200 text-xs leading-3 sm:leading-4.5 text-blue-900 h-3.75 px-1 sm:h-5 sm:px-2 font-bold"
      >
        ${tag}
      </div>
    `;
  }

  private renderIcon() {
    if (this.player.killedAt) {
      return html` <div
        class="size-7.5 leading-1.25 shrink-0 text-lg sm:size-10 pt-3 sm:leading-3.75 sm:rounded-[50%] sm:border sm:border-gray-200 text-center sm:bg-slate-500 sm:text-2xl"
      >
        💀
      </div>`;
    } else if (this.player.flag) {
      return html`<img
        src="/flags/${this.player.flag}.svg"
        class="min-w-7.5 h-7.5 sm:min-w-10 sm:h-10 shrink-0"
      />`;
    }

    return html`
      <div
        class="size-7.5 leading-1.25 shrink-0 rounded-[50%] sm:size-10 sm:pt-2.5 sm:leading-3.5 border border-gray-200 text-center bg-slate-500"
      >
        <img
          src="/images/ProfileIcon.svg"
          class="size-5 mt-0.5 sm:size-6.25 sm:-mt-1.25 m-auto"
        />
      </div>
    `;
  }
}
