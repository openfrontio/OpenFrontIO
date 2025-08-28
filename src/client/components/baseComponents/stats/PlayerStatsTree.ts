import "./PlayerStatsGrid";
import "./PlayerStatsTable";
import { Difficulty, GameMode, GameType } from "../../../../core/game/Game";
import { LitElement, html } from "lit";
import { PlayerStatsLeaf, PlayerStatsTree } from "../../../../core/ApiSchemas";
import { customElement, property, state } from "lit/decorators.js";
import { renderNumber, translateText } from "../../../Utils";
import { PlayerStats } from "../../../../core/StatsSchemas";

@customElement("player-stats-tree-view")
export class PlayerStatsTreeView extends LitElement {
  @property({ type: Object }) statsTree?: PlayerStatsTree;
  @state() visibility: GameType = GameType.Public;
  @state() selectedMode: GameMode = GameMode.FFA;
  @state() selectedDifficulty: Difficulty = Difficulty.Medium;

  private get availableTypes(): GameType[] {
    if (!this.statsTree) return [];
    return Object.keys(this.statsTree) as GameType[];
  }

  private get availableModes(): GameMode[] {
    const typeNode = this.statsTree?.[this.visibility];
    if (!typeNode) return [];
    return Object.keys(typeNode) as GameMode[];
  }

  private get availableDifficulties(): Difficulty[] {
    const typeNode = this.statsTree?.[this.visibility];
    const modeNode = typeNode?.[this.selectedMode];
    if (!modeNode) return [];
    return Object.keys(modeNode) as Difficulty[];
  }

  private labelForMode(m: GameMode) {
    return m === GameMode.FFA
      ? translateText("player_modal.mode_ffa")
      : translateText("player_modal.mode_team");
  }

  createRenderRoot() {
    return this;
  }

  private getSelectedLeaf(): PlayerStatsLeaf | null {
    const typeNode = this.statsTree?.[this.visibility];
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
    if (this.visibility === t) return;
    this.visibility = t;
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
    if (types.length && !types.includes(this.visibility)) {
      this.visibility = types[0];
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
      ? (leaf.losses === 0n ? leaf.wins : Number(leaf.wins) / Number(leaf.losses))
      : 0;

    return html`
      <!-- Visibility toggle -->
      <div class="flex gap-2 mt-2">
        ${types.map(
          (t) => html`
            <button
              class="text-xs px-2 py-0.5 rounded border ${this.visibility === t
                ? "border-white/60 text-white"
                : "border-white/20 text-gray-300"}"
              @click=${() => this.setGameType(t)}
            >
              ${t === GameType.Public
                ? translateText("player_modal.public")
                : translateText("player_modal.private")}
            </button>
          `,
        )}
      </div>

      <!-- Mode selector -->
      ${modes.length
        ? html`<div class="flex gap-2 mt-2">
            ${modes.map(
              (m) => html`
                <button
                  class="text-xs px-2 py-0.5 rounded border ${this.selectedMode === m
                    ? "border-white/60 text-white"
                    : "border-white/20 text-gray-300"}"
                  @click=${() => this.setMode(m)}
                  title=${translateText("player_modal.mode")}
                >
                  ${this.labelForMode(m)}
                </button>
              `,
            )}
          </div>`
        : html``}

      <!-- Difficulty selector -->
      ${diffs.length
        ? html`<div class="flex gap-2 mt-2">
            ${diffs.map(
              (d) => html`
                <button
                  class="text-xs px-2 py-0.5 rounded border ${this.selectedDifficulty === d
                    ? "border-white/60 text-white"
                    : "border-white/20 text-gray-300"}"
                  @click=${() => this.setDifficulty(d)}
                  title=${translateText("player_modal.difficulty")}
                >
                  ${d}
                </button>`,
            )}
          </div>`
        : html``}

      ${leaf
        ? html`
            <hr class="w-2/3 border-gray-600 my-2" />
            <player-stats-grid
              .titles=${[
                translateText("player_modal.stats_wins"),
                translateText("player_modal.stats_losses"),
                translateText("player_modal.stats_wlr"),
                translateText("player_modal.stats_games_played"),
                translateText("player_modal.stats_play_time"),
                translateText("player_modal.stats_last_active"),
              ]}
              .values=${[
                renderNumber(leaf.wins),
                renderNumber(leaf.losses),
                renderNumber(wlr),
                renderNumber(leaf.total),
                translateText("player_modal.not_applicable"),
                translateText("player_modal.not_applicable"),
              ]}
            ></player-stats-grid>

            <hr class="w-2/3 border-gray-600 my-2" />

            <player-stats-table .stats=${this.getDisplayedStats()}></player-stats-table>
          `
        : html``}
    `;
  }
}
