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
      <div class="flex flex-col gap-4">
        <!-- Filters -->
        <div
          class="flex flex-wrap gap-2 items-center justify-between p-2 bg-black/20 rounded-lg border border-white/5"
        >
          <!-- Type selector -->
          <div class="flex gap-1">
            ${types.map(
              (t) => html`
                <button
                  class="text-xs px-3 py-1.5 rounded-md border font-bold uppercase tracking-wider transition-all duration-200 ${this
                    .selectedType === t
                    ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/40"
                    : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"}"
                  @click=${() => this.setGameType(t)}
                >
                  ${t === GameType.Public
                    ? translateText("player_stats_tree.public")
                    : t === GameType.Private
                      ? translateText("player_stats_tree.private")
                      : translateText("player_stats_tree.solo")}
                </button>
              `,
            )}
          </div>

          <div class="flex gap-2">
            <!-- Mode selector -->
            ${modes.length
              ? html`<div
                  class="flex gap-1 bg-black/20 rounded-md p-1 border border-white/5"
                >
                  ${modes.map(
                    (m) => html`
                      <button
                        class="text-xs px-3 py-1 rounded-sm transition-colors ${this
                          .selectedMode === m
                          ? "bg-white/20 text-white font-bold"
                          : "text-gray-400 hover:text-white"}"
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
              ? html`<div
                  class="flex gap-1 bg-black/20 rounded-md p-1 border border-white/5"
                >
                  ${diffs.map(
                    (d) =>
                      html` <button
                        class="text-xs px-3 py-1 rounded-sm transition-colors ${this
                          .selectedDifficulty === d
                          ? "bg-white/20 text-white font-bold"
                          : "text-gray-400 hover:text-white"}"
                        @click=${() => this.setDifficulty(d)}
                        title=${translateText("difficulty.difficulty")}
                      >
                        ${translateText(`difficulty.${d.toLowerCase()}`)}
                      </button>`,
                  )}
                </div>`
              : html``}
          </div>
        </div>

        ${leaf
          ? html`
              <div class="space-y-6 mt-2">
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

                <div class="border-t border-white/10 pt-6">
                  <player-stats-table
                    .stats=${this.getDisplayedStats()}
                  ></player-stats-table>
                </div>
              </div>
            `
          : html`
              <div
                class="py-12 text-center text-white/30 italic border border-white/5 rounded-xl bg-white/5"
              >
                ${translateText("player_stats_tree.no_stats")}
              </div>
            `}
      </div>
    `;
  }
}
