import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PlayerStatsLeaf, PlayerStatsTree } from "../../../../core/ApiSchemas";
import {
  Difficulty,
  GameMode,
  GameType,
  isDifficulty,
  isGameMode,
  isGameType,
} from "../../../../core/game/Game";
import { PlayerStats } from "../../../../core/StatsSchemas";
import { renderNumber, translateText } from "../../../Utils";
import "./PlayerStatsGrid";
import "./PlayerStatsTable";

@customElement("player-stats-tree-view")
export class PlayerStatsTreeView extends LitElement {
  @property({ type: Object }) statsTree?: PlayerStatsTree;
  @state() selectedType: GameType = GameType.Public;
  @state() selectedMode: GameMode = GameMode.FFA;
  @state() selectedDifficulty: Difficulty = Difficulty.Medium;

  private get availableTypes(): GameType[] {
    if (!this.statsTree) return [];
    return Object.keys(this.statsTree).filter(isGameType);
  }

  private get availableModes(): GameMode[] {
    const typeNode = this.statsTree?.[this.selectedType];
    if (!typeNode) return [];
    return Object.keys(typeNode).filter(isGameMode);
  }

  private get availableDifficulties(): Difficulty[] {
    const typeNode = this.statsTree?.[this.selectedType];
    const modeNode = typeNode?.[this.selectedMode];
    if (!modeNode) return [];
    return Object.keys(modeNode).filter(isDifficulty);
  }

  private labelForMode(m: GameMode) {
    return m === GameMode.FFA
      ? translateText("player_stats_tree.mode_ffa")
      : translateText("player_stats_tree.mode_team");
  }

  createRenderRoot() {
    return this;
  }

  private getSelectedLeaf(): PlayerStatsLeaf | null {
    const typeNode = this.statsTree?.[this.selectedType];
    if (!typeNode) return null;
    const modeNode = typeNode[this.selectedMode];
    if (!modeNode) return null;
    const diffNode = modeNode[this.selectedDifficulty];
    if (!diffNode) return null;
    return diffNode;
  }

  private getDisplayedStats(): PlayerStats | null {
    const leaf = this.getSelectedLeaf();
    if (!leaf || !leaf.stats) return null;
    return leaf.stats;
  }

  private setGameType(t: GameType) {
    if (this.selectedType === t) return;
    this.selectedType = t;
    const modes = this.availableModes;
    if (!modes.includes(this.selectedMode)) {
      this.selectedMode = modes[0] ?? this.selectedMode;
    }
    const diffs = this.availableDifficulties;
    if (!diffs.includes(this.selectedDifficulty)) {
      this.selectedDifficulty = diffs[0] ?? this.selectedDifficulty;
    }
    this.requestUpdate();
  }

  private setMode(m: GameMode) {
    if (this.selectedMode === m) return;
    this.selectedMode = m;
    const diffs = this.availableDifficulties;
    if (!diffs.includes(this.selectedDifficulty)) {
      this.selectedDifficulty = diffs[0] ?? this.selectedDifficulty;
    }
    this.requestUpdate();
  }

  private setDifficulty(d: Difficulty) {
    if (this.selectedDifficulty === d) return;
    this.selectedDifficulty = d;
    this.requestUpdate();
  }

  render() {
    const types = this.availableTypes;
    if (types.length && !types.includes(this.selectedType)) {
      this.selectedType = types[0];
    }
    const modes = this.availableModes;
    if (modes.length && !modes.includes(this.selectedMode)) {
      this.selectedMode = modes[0];
    }
    const diffs = this.availableDifficulties;
    if (diffs.length && !diffs.includes(this.selectedDifficulty)) {
      this.selectedDifficulty = diffs[0];
    }

    const leaf = this.getSelectedLeaf();
    const wlr = leaf
      ? leaf.losses === 0n
        ? Number(leaf.wins)
        : Number(leaf.wins) / Number(leaf.losses)
      : 0;

    return html`
      <!-- Type selector -->
      <div class="flex gap-2 mt-2 justify-center">
        ${types.map(
          (t) => html`
            <button
              class="text-xs px-2 py-0.5 rounded border ${this.selectedType ===
              t
                ? "border-white/60 text-white"
                : "border-white/20 text-gray-300"}"
              @click=${() => this.setGameType(t)}
            >
              ${t === GameType.Public
                ? translateText("player_stats_tree.public")
                : t === GameType.Private
                  ? translateText("player_stats_tree.private")
                  : translateText("player_stats_tree.singleplayer")}
            </button>
          `,
        )}
      </div>
      <!-- Mode selector -->
      ${modes.length
        ? html`<div class="flex gap-2 mt-2 justify-center">
            ${modes.map(
              (m) => html`
                <button
                  class="text-xs px-2 py-0.5 rounded border ${this
                    .selectedMode === m
                    ? "border-white/60 text-white"
                    : "border-white/20 text-gray-300"}"
                  @click=${() => this.setMode(m)}
                  title=${translateText("player_stats_tree.mode")}
                >
                  ${this.labelForMode(m)}
                </button>
              `,
            )}
          </div>`
        : html``}
      <!-- Difficulty selector -->
      ${diffs.length
        ? html`<div class="flex gap-2 mt-2 justify-center">
            ${diffs.map(
              (d) =>
                html` <button
                  class="text-xs px-2 py-0.5 rounded border ${this
                    .selectedDifficulty === d
                    ? "border-white/60 text-white"
                    : "border-white/20 text-gray-300"}"
                  @click=${() => this.setDifficulty(d)}
                  title=${translateText("difficulty.difficulty")}
                >
                  ${translateText(`difficulty.${d}`)}
                </button>`,
            )}
          </div>`
        : html``}
      ${leaf
        ? html`
            <hr class="w-2/3 border-gray-600 my-2" />
            <player-stats-grid
              .titles=${[
                translateText("player_stats_tree.stats_wins"),
                translateText("player_stats_tree.stats_losses"),
                translateText("player_stats_tree.stats_wlr"),
                translateText("player_stats_tree.stats_games_played"),
              ]}
              .values=${[
                renderNumber(leaf.wins),
                renderNumber(leaf.losses),
                wlr.toFixed(2),
                renderNumber(leaf.total),
              ]}
            ></player-stats-grid>
            <hr class="w-2/3 border-gray-600 my-2" />
            <player-stats-table
              .stats=${this.getDisplayedStats()}
            ></player-stats-table>
          `
        : html``}
    `;
  }
}
