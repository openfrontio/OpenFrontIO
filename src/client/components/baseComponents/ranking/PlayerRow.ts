import {
  LitElement,
  html,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property } from "lit/decorators.js";
import { assetUrl } from "../../../../core/AssetUrls";
import { renderNumber, translateText } from "../../../Utils";
import { PlayerInfo, RANK_TYPE_LABEL_KEYS, RankType } from "./GameInfoRanking";

const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");

@customElement("player-row")
export class PlayerRow extends LitElement {
  @property({ type: Object }) player: PlayerInfo;
  @property({ type: String }) rankType: RankType;
  @property({ type: Number }) bestScore = 1;
  @property({ type: Number }) rank = 1;
  @property({ type: Number }) score = 0;
  @property({ type: Boolean }) currentPlayer = false;

  private failedFlag: string | null = null;

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.player) return html``;
    const { player } = this;
    return html`
      <li
        data-player-row
        class="group relative grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-3 transition-colors duration-150 hover:bg-white/[0.055] sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(13rem,0.9fr)] sm:px-5 sm:py-2.5 ${player.winner
          ? "bg-gradient-to-r from-yellow-400/[0.08] via-yellow-400/[0.025] to-transparent"
          : this.currentPlayer
            ? "bg-malibu-blue/10"
            : "bg-transparent"}"
      >
        ${player.winner
          ? html`<div
              class="absolute inset-y-0 left-0 w-0.5 bg-yellow-400/70"
            ></div>`
          : ""}
        ${this.renderRank()} ${this.renderIdentity()}
        <div class="col-start-2 min-w-0 sm:col-start-auto">
          ${this.renderPlayerInfo()}
        </div>
      </li>
    `;
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("player")) {
      const previous = changed.get("player") as PlayerInfo | undefined;
      if (previous?.flag !== this.player?.flag) this.failedFlag = null;
    }
  }

  private renderRank(): TemplateResult {
    const rankClass =
      {
        1: "border-yellow-400/20 bg-yellow-400/10 text-yellow-300",
        2: "border-slate-300/15 bg-slate-300/10 text-slate-300",
        3: "border-amber-600/20 bg-amber-600/10 text-amber-500",
      }[this.rank] ?? "border-white/[0.06] bg-white/[0.035] text-white/35";
    return html`
      <div
        class="flex size-8 items-center justify-center rounded-lg border font-mono text-xs font-bold tabular-nums sm:size-9 sm:text-sm ${rankClass}"
        aria-label=${String(this.rank)}
      >
        ${this.rank}
      </div>
    `;
  }

  private renderPlayerIcon() {
    return html`
      <div class="relative shrink-0">
        ${this.renderIcon()}
        ${this.player.winner
          ? this.renderCrownIcon()
          : this.player.killedAt !== undefined
            ? this.renderEliminatedIcon()
            : ""}
      </div>
    `;
  }

  private renderCrownIcon() {
    return html`
      <span
        data-player-status="winner"
        class="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-yellow-300/40 bg-yellow-400 text-yellow-950 shadow-lg"
        role="img"
        aria-label=${translateText("clan_modal.history_result_victory")}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          class="size-3"
          aria-hidden="true"
        >
          <path
            d="m4 7 4.2 3L12 5l3.8 5L20 7l-1.5 10h-13L4 7Zm2 12h12v2H6v-2Z"
          />
        </svg>
      </span>
    `;
  }

  private renderEliminatedIcon(): TemplateResult {
    return html`
      <span
        data-player-status="eliminated"
        class="absolute -bottom-1 -right-1 leading-none drop-shadow-md"
        role="img"
        aria-label=${translateText("clan_modal.history_result_defeat")}
      >
        <span class="text-sm leading-none" aria-hidden="true">💀</span>
      </span>
    `;
  }

  private renderIdentity(): TemplateResult {
    return html`
      <div class="flex min-w-0 items-center gap-3">
        ${this.renderPlayerIcon()}
        <div
          data-player-identity
          class="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          ${this.player.clanTag
            ? html`<div
                data-player-clan-tag
                class="inline-flex min-w-0 max-w-[40%] shrink-0 rounded-md border border-malibu-blue/20 bg-malibu-blue/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-aquarius/85"
              >
                <span class="truncate">${this.player.clanTag}</span>
              </div>`
            : ""}
          <div
            data-player-name
            class="min-w-0 flex-1 truncate text-sm font-semibold tracking-wide text-white/85 sm:text-[15px]"
            title=${this.player.username}
          >
            ${this.player.username}
          </div>
        </div>
      </div>
    `;
  }

  private renderPlayerInfo() {
    switch (this.rankType) {
      case RankType.Lifetime:
      case RankType.ConquestHumans:
      case RankType.ConquestNations:
      case RankType.ConquestBots:
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
    const isLifetime = this.rankType === RankType.Lifetime;
    const formattedScore = `${Number(this.score).toFixed(0)}${
      isLifetime ? "%" : ""
    }`;
    return html`
      <div class="flex w-full items-center gap-3">
        ${this.renderScoreBar(formattedScore)}
        <div
          data-player-score
          aria-hidden="true"
          class="flex min-h-10 shrink-0 items-center justify-end gap-2 px-3 py-2 font-mono text-sm font-bold tabular-nums text-white/75"
        >
          ${formattedScore}
        </div>
      </div>
    `;
  }

  private renderScoreBar(formattedScore: string) {
    const bestScore = Math.max(this.bestScore, 1);
    const currentScore = Math.max(this.score, 0);
    const accessibleMax = Math.max(bestScore, currentScore);
    const width = Math.min(Math.max((this.score / bestScore) * 100, 0), 100);
    return html`
      <div class="w-full">
        <div
          role="progressbar"
          aria-label=${this.scoreLabel()}
          aria-valuemin="0"
          aria-valuemax=${accessibleMax}
          aria-valuenow=${currentScore}
          aria-valuetext=${formattedScore}
          class="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]"
        >
          <div
            class="h-full rounded-full bg-gradient-to-r from-malibu-blue/65 to-aquarius shadow-[0_0_10px_rgba(63,169,245,0.2)] w-(--width)"
            style="--width: ${width}%;"
          ></div>
        </div>
      </div>
    `;
  }

  private renderBombScore() {
    return this.renderValueScore(false);
  }

  private renderGoldScore() {
    return this.renderValueScore(true);
  }

  private renderTradeScore() {
    return this.renderValueScore(true);
  }

  private renderValueScore(showCoin: boolean) {
    const formattedScore = renderNumber(this.score);
    return html`
      <div
        data-player-score
        aria-label=${`${this.scoreLabel()}, ${formattedScore}`}
        class="flex min-h-10 items-center justify-end gap-2 px-3 py-2 font-mono text-sm font-bold tabular-nums text-white/75"
      >
        ${showCoin ? this.renderCoinIcon() : ""}
        <div>${formattedScore}</div>
      </div>
    `;
  }

  private scoreLabel(): string {
    return `${this.player.username}: ${translateText(
      RANK_TYPE_LABEL_KEYS[this.rankType],
    )}`;
  }

  private renderIcon() {
    const flagUrl = this.getFlagUrl();
    if (flagUrl) {
      return html`<img
        data-player-avatar="flag"
        src=${flagUrl}
        alt=""
        draggable="false"
        decoding="async"
        @error=${() => this.handleFlagError()}
        class="size-10 rounded-xl border border-white/10 bg-white/[0.055] object-contain p-1"
      />`;
    }

    return html`
      <div
        data-player-avatar="fallback"
        class="flex size-10 items-center justify-center rounded-xl border border-malibu-blue/15 bg-gradient-to-br from-malibu-blue/20 to-white/[0.04] text-xs font-bold uppercase tracking-wide text-aquarius/80"
        aria-hidden="true"
      >
        ${this.initials()}
      </div>
    `;
  }

  private getFlagUrl(): string | null {
    if (!this.player.flag || this.failedFlag === this.player.flag) return null;
    try {
      return assetUrl(this.player.flag);
    } catch {
      return null;
    }
  }

  private handleFlagError(): void {
    this.failedFlag = this.player.flag ?? null;
    this.requestUpdate();
  }

  private initials(): string {
    const normalized = this.player.username.trim();
    return normalized.length > 0 ? normalized.slice(0, 2).toUpperCase() : "?";
  }

  private renderCoinIcon(): TemplateResult {
    return html`<img
      src=${goldCoinIcon}
      width="18"
      height="18"
      class="size-[18px] shrink-0"
      alt=""
      aria-hidden="true"
    />`;
  }
}
