import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
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
        class="bg-gradient-to-r ${player.winner
          ? "from-sky-400 to-blue-700"
          : "bg-slate-700"} border-[2px]
          ${player.winner
          ? "border-yellow-500"
          : "border-yellow-50"} ${visibleBorder ? "" : "border-opacity-0"}
          relative pt-1 pb-1 pr-2 pl-2 sm:pl-5 sm:pr-5 mb-[5px] rounded-lg flex justify-between items-center hover:bg-slate-500 transition duration-150 ease-in-out"
      >
        <div
          class="font-bold text-right w-[30px] text-lg text-white absolute left-[-40px]"
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
        class="absolute top-[-3px] left-[16px] w-[15px] h-[15px] sm:top-[-7px] sm:left-[30px] sm:w-[20px] sm:h-[20px]"
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
      case RankType.TradedGold:
      case RankType.ConqueredGold:
      case RankType.StolenGold:
        return this.renderGoldScore();
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
          class="font-bold rounded-[50%] w-[30px] h-[30px] leading-[1.6rem] border text-center bg-white text-black"
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
      <div class="w-full pr-[10px] m-auto">
        <div class="h-[7px] bg-neutral-800" style="width: 100%;">
          <!-- bar background -->
          <div class="h-[7px] bg-white" style="width: ${width}%;"></div>
        </div>
      </div>
    `;
  }
  private renderBombType(value: number, highlight: boolean) {
    return html`
      <div
        class="${highlight
          ? "font-bold text-[18px]"
          : ""} min-w-[30px] sm:min-w-[60px] inline-block text-center"
      >
        ${value}
      </div>
    `;
  }

  private renderAllBombs() {
    return html`
      <div class="flex justify-between text-sm sm:pr-20">
        ${this.renderBombType(
          this.player.atoms,
          this.rankType === RankType.Atoms,
        )}
        /
        ${this.renderBombType(
          this.player.hydros,
          this.rankType === RankType.Hydros,
        )}
        /
        ${this.renderBombType(
          this.player.mirv,
          this.rankType === RankType.MIRV,
        )}
      </div>
    `;
  }

  private renderBombScore() {
    return html`
      <div class="flex gap-3 items-center w-full">
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
        <div
          class="text-left w-[125px] max-w-[125px] sm:w-[250px] sm:max-w-[250px]"
        >
          ${this.renderPlayerName()}
        </div>
      </div>
      <div class="flex gap-2">
        <div
          class="font-bold rounded-md w-[60px] max-w-[60px] h-[30px] text-sm sm:w-[100px] sm:h-[30px] leading-[1.9rem] text-center"
        >
          ${renderNumber(this.score)}
        </div>
        <img
          src="/images/GoldCoinIcon.svg"
          class="w-[14px] h-[14px] sm:w-[20px] sm:h-[20px] m-auto"
        />
      </div>
    `;
  }

  private renderPlayerName() {
    return html`
      <div class="flex gap-1 items-center max-w-[200px] min-w-[200px]">
        ${this.player.tag ? this.renderTag(this.player.tag) : ""}
        <div
          class="text-xs sm:text-sm font-bold text-ellipsis max-w-[150px] min-w-[150px] overflow-hidden whitespace-nowrap"
        >
          ${this.player.username}
        </div>
      </div>
    `;
  }

  private renderTag(tag: string) {
    return html`
      <div
        class="bg-white text-black rounded-lg sm:rounded-xl border text-xs leading-[12px] sm:leading-[18px] text-blue-900 h-[15px] pr-[4px] pl-[4px] sm:h-[20px] sm:pr-[8px] sm:pl-[8px] font-bold"
      >
        ${tag}
      </div>
    `;
  }

  private renderIcon() {
    if (this.player.killedAt) {
      return html` <div
        class="w-[30px] h-[30px] leading-[5px] text-lg sm:min-w-[40px] sm:w-[40px] sm:h-[40px] pt-[12px] sm:leading-[15px] sm:rounded-[50%] sm:border text-center sm:bg-slate-500 sm:text-2xl"
      >
        💀
      </div>`;
    } else if (this.player.flag) {
      return html`<img
        src="/flags/${this.player.flag}.svg"
        class="min-w-[30px] h-[30px] sm:min-w-[40px] sm:h-[40px]"
      />`;
    }

    return html`
      <div
        class="w-[30px] h-[30px] min-w-[30px] leading-[5px] rounded-[50%] sm:min-w-[40px] sm:w-[40px] sm:h-[40px] sm:pt-[10px] sm:leading-[14px] border text-center bg-slate-500"
      >
        <img
          src="/images/ProfileIcon.svg"
          class="w-[20px] h-[20px] mt-[2px] sm:w-[25px] sm:h-[25px] sm:mt-[-5px] m-auto"
        />
      </div>
    `;
  }
}
