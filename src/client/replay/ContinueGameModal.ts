import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { Difficulty } from "../../core/game/Game";
import { translateText } from "../Utils";
import { formatGameTime } from "./ReplayControls";

export interface ContinuePlayerOption {
  id: string;
  name: string;
  smallID: number;
  flag?: string;
  troops: number;
  tiles: number;
  controlPercent?: number;
}

@customElement("continue-game-modal")
export class ContinueGameModal extends LitElement {
  @property({ type: Number }) tick = 0;
  @property({ type: Array }) players: ContinuePlayerOption[] = [];
  @property({ type: String }) initialPlayerID = "";
  @property({ type: Boolean }) open = false;

  @state() private selectedPlayerID = "";
  @state() private selectedDifficulty: Difficulty = Difficulty.Medium;
  @state() private searchQuery = "";
  @state() private loading = false;
  @state() private error = "";

  createRenderRoot() {
    return this;
  }

  willUpdate(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has("open") && !this.open) {
      this.searchQuery = "";
    }
    if (changedProperties.has("initialPlayerID") && this.initialPlayerID) {
      this.selectedPlayerID = this.initialPlayerID;
    }
    if (
      changedProperties.has("players") &&
      !this.selectedPlayerID &&
      this.players.length > 0
    ) {
      this.selectedPlayerID = this.players[0].id;
    }
  }

  private renderFlag(flag?: string) {
    if (!flag) return nothing;
    if (flag.includes("/") || flag.includes(".svg")) {
      return html`<img
        src=${assetUrl(flag)}
        alt=""
        class="w-5 h-3.5 object-cover rounded-xs shrink-0"
      />`;
    }
    return html`<span class="text-base shrink-0">${flag}</span>`;
  }

  private close(): void {
    if (this.loading) return;
    this.open = false;
    this.error = "";
    this.searchQuery = "";
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }

  private async handleConfirm(): Promise<void> {
    if (!this.selectedPlayerID || this.loading) return;
    this.loading = true;
    this.error = "";
    this.dispatchEvent(
      new CustomEvent("continue", {
        detail: {
          playerID: this.selectedPlayerID,
          difficulty: this.selectedDifficulty,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  public setLoading(isLoading: boolean, errorMsg = ""): void {
    this.loading = isLoading;
    this.error = errorMsg;
  }

  render() {
    if (!this.open) return nothing;

    const timeStr = formatGameTime(this.tick);

    return html`
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-200"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.close();
        }}
      >
        <div
          class="relative w-full max-w-lg bg-gray-900 border border-white/10 rounded-2xl shadow-2xl p-6 flex flex-col gap-5 text-white"
        >
          <!-- Header -->
          <div
            class="flex items-center justify-between border-b border-white/10 pb-4"
          >
            <div>
              <h2 class="text-xl font-bold tracking-tight text-white">
                ${translateText("replay_viewer.continue_modal_title")}
              </h2>
              <p class="text-xs text-zinc-400 mt-1">
                ${translateText("replay_viewer.continue_modal_desc")}
              </p>
            </div>
            <button
              class="text-zinc-400 hover:text-white transition p-1.5 rounded-lg hover:bg-white/10"
              @click=${this.close}
              ?disabled=${this.loading}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <!-- Time Info -->
          <div
            class="px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between text-sm"
          >
            <span class="text-zinc-400">
              ${translateText("replay_viewer.game_time")}
            </span>
            <span
              class="font-mono text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-medium"
            >
              ${timeStr}
            </span>
          </div>

          <!-- Player Selection -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <label class="text-sm font-semibold text-zinc-200">
                ${translateText("replay_viewer.select_player")}
              </label>
              ${this.players.length > 0
                ? html`<span class="text-xs text-zinc-400">
                    ${this.searchQuery.trim()
                      ? `${
                          this.players.filter((p) =>
                            p.name
                              .toLowerCase()
                              .includes(this.searchQuery.trim().toLowerCase()),
                          ).length
                        } / ${this.players.length}`
                      : `${this.players.length}`}
                  </span>`
                : nothing}
            </div>

            <!-- Search Bar -->
            <div class="relative">
              <input
                type="text"
                placeholder="${translateText("replay_viewer.search_players")}"
                .value=${this.searchQuery}
                @input=${(e: InputEvent) => {
                  this.searchQuery = (e.target as HTMLInputElement).value;
                }}
                class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-400 focus:outline-none focus:border-sky-400 transition"
              />
              ${this.searchQuery
                ? html`<button
                    type="button"
                    class="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white text-xs"
                    @click=${() => (this.searchQuery = "")}
                  >
                    ✕
                  </button>`
                : nothing}
            </div>

            <div
              class="max-h-48 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar"
            >
              ${(() => {
                const query = this.searchQuery.trim().toLowerCase();
                const filtered = query
                  ? this.players.filter((p) =>
                      p.name.toLowerCase().includes(query),
                    )
                  : this.players;

                if (filtered.length === 0) {
                  return html`
                    <div class="text-xs text-zinc-400 text-center py-4">
                      ${translateText("replay_viewer.no_players_found")}
                    </div>
                  `;
                }

                return filtered.map((p) => {
                  const isSelected = p.id === this.selectedPlayerID;
                  return html`
                    <button
                      type="button"
                      class="w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-left transition border ${isSelected
                        ? "bg-sky-500/20 border-sky-400 text-white"
                        : "bg-white/5 border-transparent text-zinc-300 hover:bg-white/10"}"
                      @click=${() => (this.selectedPlayerID = p.id)}
                      ?disabled=${this.loading}
                    >
                      <div class="flex items-center gap-2.5 truncate">
                        ${this.renderFlag(p.flag)}
                        <span class="font-medium truncate">${p.name}</span>
                      </div>
                      <div
                        class="text-xs text-zinc-400 flex items-center gap-3 shrink-0"
                      >
                        <span>
                          ${translateText("replay_viewer.player_stats_troops", {
                            troops: p.troops.toLocaleString(),
                          })}
                        </span>
                        <span>
                          ${translateText(
                            "replay_viewer.player_stats_control",
                            {
                              percent: `${(p.controlPercent ?? 0).toFixed(1)}%`,
                            },
                          )}
                        </span>
                      </div>
                    </button>
                  `;
                });
              })()}
            </div>
          </div>

          <!-- Bot Difficulty Selection -->
          <div class="flex flex-col gap-2">
            <label class="text-sm font-semibold text-zinc-200">
              ${translateText("replay_viewer.bot_difficulty")}
            </label>
            <div class="grid grid-cols-4 gap-2">
              ${[
                Difficulty.Easy,
                Difficulty.Medium,
                Difficulty.Hard,
                Difficulty.Impossible,
              ].map(
                (diff) => html`
                  <button
                    type="button"
                    class="py-1.5 px-2 text-xs font-medium rounded-lg border transition text-center ${this
                      .selectedDifficulty === diff
                      ? "bg-sky-500 border-sky-400 text-white"
                      : "bg-white/5 border-transparent text-zinc-400 hover:bg-white/10 hover:text-white"}"
                    @click=${() => (this.selectedDifficulty = diff)}
                    ?disabled=${this.loading}
                  >
                    ${diff}
                  </button>
                `,
              )}
            </div>
          </div>

          ${this.error
            ? html`<div
                class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-2.5 rounded-lg"
              >
                ${this.error}
              </div>`
            : nothing}

          <!-- Actions -->
          <div class="flex items-center justify-end gap-3 pt-2">
            <button
              class="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white transition rounded-xl hover:bg-white/10"
              @click=${this.close}
              ?disabled=${this.loading}
            >
              ${translateText("replay_viewer.cancel")}
            </button>
            <button
              class="px-5 py-2 text-sm font-semibold text-white bg-sky-500 hover:bg-sky-400 active:bg-sky-600 transition rounded-xl shadow-lg shadow-sky-500/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              @click=${this.handleConfirm}
              ?disabled=${this.loading || !this.selectedPlayerID}
            >
              ${this.loading
                ? html`
                    <div
                      class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                    ></div>
                    <span
                      >${translateText("replay_viewer.preparing_game")}</span
                    >
                  `
                : html`<span>${translateText("replay_viewer.play_now")}</span>`}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
