import { LitElement, PropertyValues, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { PlayerStatsLeaf, PlayerStatsTree } from "../../../../core/ApiSchemas";
import {
  Difficulty,
  GameMode,
  GameType,
  RankedType,
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
  @state() selectedType: GameType | "Ranked" = GameType.Public;
  @state() selectedMode: GameMode = GameMode.FFA;
  @state() selectedDifficulty: Difficulty = Difficulty.Medium;
  @state() selectedRankedType: RankedType = RankedType.OneVOne;
  private get typeNode() {
    if (this.selectedType === "Ranked") return undefined;
    return this.statsTree?.[this.selectedType];
  }

  private get modeNode() {
    return this.typeNode?.[this.selectedMode];
  }

  private get shouldMergeDifficulties() {
    return this.selectedType === GameType.Public;
  }

  private get availableTypes(): (GameType | "Ranked")[] {
    if (!this.statsTree) return [];
    const types: (GameType | "Ranked")[] = Object.keys(this.statsTree).filter(
      (k): k is GameType =>
        isGameType(k) &&
        Object.keys(this.statsTree![k as GameType] ?? {}).length > 0,
    );
    if (
      this.statsTree.Ranked &&
      Object.keys(this.statsTree.Ranked).length > 0
    ) {
      types.push("Ranked");
    }
    return types;
  }

  private get availableModes(): GameMode[] {
    if (!this.typeNode) return [];
    return Object.keys(this.typeNode).filter(isGameMode);
  }

  private get availableRankedTypes(): RankedType[] {
    if (!this.statsTree?.Ranked) return [];
    return Object.keys(this.statsTree.Ranked).filter((k): k is RankedType =>
      Object.values(RankedType).includes(k as RankedType),
    );
  }

  private get availableDifficulties(): Difficulty[] {
    if (!this.modeNode) return [];
    return Object.keys(this.modeNode).filter(isDifficulty);
  }

  private labelForMode(m: GameMode) {
    return m === GameMode.FFA
      ? translateText("game_mode.ffa")
      : translateText("game_mode.teams");
  }

  private labelForRankedType(r: RankedType) {
    switch (r) {
      case RankedType.OneVOne:
        return translateText("player_stats_tree.ranked_1v1");
    }
  }

  createRenderRoot() {
    return this;
  }

  private getSelectedLeaf(): PlayerStatsLeaf | null {
    if (this.selectedType === "Ranked") {
      return this.statsTree?.Ranked?.[this.selectedRankedType] ?? null;
    }

    const modeNode = this.modeNode;
    if (!modeNode) return null;

    if (!this.shouldMergeDifficulties) {
      return modeNode[this.selectedDifficulty] ?? null;
    }

    const diffKeys = Object.keys(modeNode).filter(isDifficulty);
    if (!diffKeys.length) return null;

    return diffKeys.reduce<PlayerStatsLeaf | null>((merged, diffKey) => {
      const leaf = modeNode[diffKey];
      if (!leaf) return merged;
      if (!merged) {
        return {
          wins: leaf.wins,
          losses: leaf.losses,
          total: leaf.total,
          stats: this.cloneStats(leaf.stats),
        };
      }
      return {
        wins: merged.wins + leaf.wins,
        losses: merged.losses + leaf.losses,
        total: merged.total + leaf.total,
        stats: this.mergeStats(merged.stats, leaf.stats),
      };
    }, null);
  }

  private syncSelection(): void {
    const types = this.availableTypes;
    if (types.length && !types.includes(this.selectedType as GameType)) {
      this.selectedType = types[0];
    }
    if (this.selectedType === "Ranked") {
      const rankedTypes = this.availableRankedTypes;
      if (
        rankedTypes.length &&
        !rankedTypes.includes(this.selectedRankedType)
      ) {
        this.selectedRankedType = rankedTypes[0];
      }
      return;
    }
    const modes = this.availableModes;
    if (modes.length && !modes.includes(this.selectedMode)) {
      this.selectedMode = modes[0];
    }
    const diffs = this.availableDifficulties;
    if (
      !this.shouldMergeDifficulties &&
      diffs.length &&
      !diffs.includes(this.selectedDifficulty)
    ) {
      this.selectedDifficulty = diffs[0];
    }
  }

  protected willUpdate(changedProperties: PropertyValues) {
    if (
      changedProperties.has("statsTree") ||
      changedProperties.has("selectedType") ||
      changedProperties.has("selectedMode") ||
      changedProperties.has("selectedDifficulty") ||
      changedProperties.has("selectedRankedType")
    ) {
      this.syncSelection();
    }
  }

  private setGameType(t: GameType | "Ranked") {
    if (this.selectedType === t) return;
    this.selectedType = t;
    this.requestUpdate();
  }

  private setMode(m: GameMode) {
    if (this.selectedMode === m) return;
    this.selectedMode = m;
    this.requestUpdate();
  }

  private setRankedType(r: RankedType) {
    if (this.selectedRankedType === r) return;
    this.selectedRankedType = r;
    this.requestUpdate();
  }

  private setDifficulty(d: Difficulty) {
    if (this.selectedDifficulty === d) return;
    this.selectedDifficulty = d;
    this.requestUpdate();
  }

  private mergeStats(
    base: PlayerStats | undefined,
    next: PlayerStats | undefined,
  ): PlayerStats | undefined {
    if (!base && !next) return undefined;
    if (!base) return this.cloneStats(next);
    if (!next) return this.cloneStats(base);

    return {
      attacks: this.mergeStatArrays(base.attacks, next.attacks),
      betrayals: this.mergeStatValue(base.betrayals, next.betrayals),
      killedAt: this.mergeStatValue(base.killedAt, next.killedAt),
      conquests: this.mergeStatArrays(base.conquests, next.conquests),
      boats: this.mergeStatRecord(base.boats, next.boats),
      bombs: this.mergeStatRecord(base.bombs, next.bombs),
      gold: this.mergeStatArrays(base.gold, next.gold),
      units: this.mergeStatRecord(base.units, next.units),
    };
  }

  private mergeStatValue(
    base: bigint | undefined,
    next: bigint | undefined,
  ): bigint | undefined {
    if (base === undefined && next === undefined) return undefined;
    return (base ?? 0n) + (next ?? 0n);
  }

  private mergeStatArrays(
    base: bigint[] | undefined,
    next: bigint[] | undefined,
  ): bigint[] | undefined {
    if (!base && !next) return undefined;
    const maxLen = Math.max(base?.length ?? 0, next?.length ?? 0);
    const merged: bigint[] = [];
    for (let i = 0; i < maxLen; i += 1) {
      merged[i] = (base?.[i] ?? 0n) + (next?.[i] ?? 0n);
    }
    return merged;
  }

  private mergeStatRecord<T extends string>(
    base: Partial<Record<T, bigint[]>> | undefined,
    next: Partial<Record<T, bigint[]>> | undefined,
  ): Partial<Record<T, bigint[]>> | undefined {
    if (!base && !next) return undefined;
    const merged: Partial<Record<T, bigint[]>> = {};
    const keys = new Set([
      ...Object.keys(base ?? {}),
      ...Object.keys(next ?? {}),
    ]) as Set<T>;
    keys.forEach((key) => {
      const mergedArray = this.mergeStatArrays(base?.[key], next?.[key]);
      if (mergedArray) {
        merged[key] = mergedArray;
      }
    });
    return Object.keys(merged).length ? merged : undefined;
  }

  private cloneStats(stats: PlayerStats | undefined): PlayerStats | undefined {
    if (!stats) return undefined;
    return {
      attacks: stats.attacks ? [...stats.attacks] : undefined,
      betrayals: stats.betrayals,
      killedAt: stats.killedAt,
      conquests: stats.conquests ? [...stats.conquests] : undefined,
      boats: stats.boats ? { ...stats.boats } : undefined,
      bombs: stats.bombs ? { ...stats.bombs } : undefined,
      gold: stats.gold ? [...stats.gold] : undefined,
      units: stats.units ? { ...stats.units } : undefined,
    };
  }

  render() {
    const types = this.availableTypes;
    const modes = this.availableModes;
    const diffs = this.availableDifficulties;
    const rankedTypes = this.availableRankedTypes;
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
                  ${t === "Ranked"
                    ? translateText("player_stats_tree.ranked")
                    : t === GameType.Public
                      ? translateText("player_stats_tree.public")
                      : t === GameType.Private
                        ? translateText("player_stats_tree.private")
                        : translateText("player_stats_tree.solo")}
                </button>
              `,
            )}
          </div>

          <div class="flex gap-2">
            <!-- Ranked type selector -->
            ${this.selectedType === "Ranked" && rankedTypes.length
              ? html`<div
                  class="flex gap-1 bg-black/20 rounded-md p-1 border border-white/5"
                >
                  ${rankedTypes.map(
                    (r) => html`
                      <button
                        class="text-xs px-3 py-1 rounded-sm transition-colors ${this
                          .selectedRankedType === r
                          ? "bg-white/20 text-white font-bold"
                          : "text-gray-400 hover:text-white"}"
                        @click=${() => this.setRankedType(r)}
                      >
                        ${this.labelForRankedType(r)}
                      </button>
                    `,
                  )}
                </div>`
              : html``}

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
            ${!this.shouldMergeDifficulties && diffs.length
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
                    .stats=${leaf?.stats ?? null}
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
