import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "./Utils";

export interface LobbyNotificationCriteria {
  gameMode: "FFA" | "Team";
  minPlayers?: number;
  maxPlayers?: number;
  teamCounts?: Array<string | number>;
}

// Team configuration options
const FIXED_TEAM_MODES = ["Duos", "Trios", "Quads"] as const;
const VARIABLE_TEAM_COUNTS = [2, 3, 4, 5, 6, 7] as const;
const ALL_TEAM_OPTIONS = [...FIXED_TEAM_MODES, ...VARIABLE_TEAM_COUNTS];

@customElement("lobby-notification-modal")
export class LobbyNotificationModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private ffaEnabled = false;
  @state() private teamEnabled = false;
  @state() private soundEnabled = true;
  @state() private ffaMinPlayers = 2;
  @state() private ffaMaxPlayers = 100;
  @state() private teamMinPlayers = 2;
  @state() private teamMaxPlayers = 100;
  @state() private selectedTeamCounts: Set<string | number> = new Set();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadSettings();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  private loadSettings() {
    try {
      const saved = localStorage.getItem("lobbyNotificationSettings");
      if (saved) {
        const settings = JSON.parse(saved);
        this.ffaEnabled = settings.ffaEnabled ?? false;
        this.teamEnabled = settings.teamEnabled ?? false;
        this.soundEnabled = settings.soundEnabled ?? true;
        this.ffaMinPlayers = settings.ffaMinPlayers ?? 2;
        this.ffaMaxPlayers = settings.ffaMaxPlayers ?? 100;
        this.teamMinPlayers = settings.teamMinPlayers ?? 2;
        this.teamMaxPlayers = settings.teamMaxPlayers ?? 100;
        this.selectedTeamCounts = new Set(settings.selectedTeamCounts ?? []);
      }
    } catch (error) {
      console.error("Failed to load notification settings:", error);
    }
  }

  private saveSettings() {
    try {
      const settings = {
        ffaEnabled: this.ffaEnabled,
        teamEnabled: this.teamEnabled,
        soundEnabled: this.soundEnabled,
        ffaMinPlayers: this.ffaMinPlayers,
        ffaMaxPlayers: this.ffaMaxPlayers,
        teamMinPlayers: this.teamMinPlayers,
        teamMaxPlayers: this.teamMaxPlayers,
        selectedTeamCounts: Array.from(this.selectedTeamCounts),
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );

      // Dispatch event to notify the manager
      window.dispatchEvent(
        new CustomEvent("notification-settings-changed", { detail: settings }),
      );
    } catch (error) {
      console.error("Failed to save notification settings:", error);
    }
  }

  public getCriteria(): LobbyNotificationCriteria[] {
    const criteria: LobbyNotificationCriteria[] = [];

    if (this.ffaEnabled) {
      criteria.push({
        gameMode: "FFA",
        minPlayers: this.ffaMinPlayers,
        maxPlayers: this.ffaMaxPlayers,
      });
    }

    if (this.teamEnabled) {
      const teamCounts = Array.from(this.selectedTeamCounts);
      criteria.push({
        gameMode: "Team",
        minPlayers: this.teamMinPlayers,
        maxPlayers: this.teamMaxPlayers,
        ...(teamCounts.length ? { teamCounts } : {}),
      });
    }

    return criteria;
  }

  public isEnabled(): boolean {
    return this.ffaEnabled || this.teamEnabled;
  }

  public isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

  private handleFFAChange(e: Event) {
    this.ffaEnabled = (e.target as HTMLInputElement).checked;
    this.saveSettings();
  }

  private handleTeamChange(e: Event) {
    this.teamEnabled = (e.target as HTMLInputElement).checked;
    this.saveSettings();
  }

  private handleSoundChange(e: Event) {
    this.soundEnabled = (e.target as HTMLInputElement).checked;
    this.saveSettings();
  }

  private handleTeamCountChange(value: string | number, e: Event) {
    if ((e.target as HTMLInputElement).checked) {
      this.selectedTeamCounts.add(value);
    } else {
      this.selectedTeamCounts.delete(value);
    }
    this.requestUpdate();
    this.saveSettings();
  }

  private handleSliderChange() {
    this.saveSettings();
  }

  private selectAllTeams() {
    this.selectedTeamCounts = new Set(ALL_TEAM_OPTIONS);
    this.requestUpdate();
    this.saveSettings();
  }

  private deselectAllTeams() {
    this.selectedTeamCounts.clear();
    this.requestUpdate();
    this.saveSettings();
  }

  render() {
    return html`
      <o-modal
        id="lobbyNotificationModal"
        title="${translateText("lobby_notification_modal.title")}"
        translationKey=""
      >
        <div class="flex flex-col gap-4 text-white">
          <!-- FFA Section -->
          <div class="bg-gray-800 bg-opacity-50 p-4 rounded-lg">
            <label class="flex items-center gap-2 cursor-pointer mb-3">
              <input
                type="checkbox"
                .checked=${this.ffaEnabled}
                @change=${this.handleFFAChange}
                class="w-5 h-5"
              />
              <span class="font-bold text-lg"
                >${translateText("game_mode.ffa")}</span
              >
            </label>

            ${this.ffaEnabled
              ? html`
                  <div class="ml-7 space-y-3">
                    <div class="text-sm text-gray-300 mb-2">
                      ${translateText(
                        "lobby_notification_modal.capacity_range",
                      )}
                    </div>
                    <div class="space-y-2">
                      <div class="flex items-center gap-4">
                        <label class="w-12 text-sm"
                          >${translateText(
                            "lobby_notification_modal.min",
                          )}</label
                        >
                        <input
                          type="range"
                          min="2"
                          max="100"
                          .value=${this.ffaMinPlayers.toString()}
                          @input=${(e: Event) => {
                            this.ffaMinPlayers = parseInt(
                              (e.target as HTMLInputElement).value,
                            );
                            if (this.ffaMinPlayers > this.ffaMaxPlayers) {
                              this.ffaMaxPlayers = this.ffaMinPlayers;
                            }
                            this.requestUpdate();
                          }}
                          @change=${this.handleSliderChange}
                          class="flex-1"
                        />
                        <span class="w-12 text-right"
                          >${this.ffaMinPlayers}</span
                        >
                      </div>
                      <div class="flex items-center gap-4">
                        <label class="w-12 text-sm"
                          >${translateText(
                            "lobby_notification_modal.max",
                          )}</label
                        >
                        <input
                          type="range"
                          min="2"
                          max="100"
                          .value=${this.ffaMaxPlayers.toString()}
                          @input=${(e: Event) => {
                            this.ffaMaxPlayers = parseInt(
                              (e.target as HTMLInputElement).value,
                            );
                            if (this.ffaMaxPlayers < this.ffaMinPlayers) {
                              this.ffaMinPlayers = this.ffaMaxPlayers;
                            }
                            this.requestUpdate();
                          }}
                          @change=${this.handleSliderChange}
                          class="flex-1"
                        />
                        <span class="w-12 text-right"
                          >${this.ffaMaxPlayers}</span
                        >
                      </div>
                    </div>
                  </div>
                `
              : ""}
          </div>

          <!-- Team Section -->
          <div class="bg-gray-800 bg-opacity-50 p-4 rounded-lg">
            <label class="flex items-center gap-2 cursor-pointer mb-3">
              <input
                type="checkbox"
                .checked=${this.teamEnabled}
                @change=${this.handleTeamChange}
                class="w-5 h-5"
              />
              <span class="font-bold text-lg"
                >${translateText("game_mode.teams")}</span
              >
            </label>

            ${this.teamEnabled
              ? html`
                  <div class="ml-7 space-y-3">
                    <div class="text-sm text-gray-300 mb-2">
                      ${translateText(
                        "lobby_notification_modal.capacity_range",
                      )}
                    </div>
                    <div class="space-y-2">
                      <div class="flex items-center gap-4">
                        <label class="w-12 text-sm"
                          >${translateText(
                            "lobby_notification_modal.min",
                          )}</label
                        >
                        <input
                          type="range"
                          min="2"
                          max="100"
                          .value=${this.teamMinPlayers.toString()}
                          @input=${(e: Event) => {
                            this.teamMinPlayers = parseInt(
                              (e.target as HTMLInputElement).value,
                            );
                            if (this.teamMinPlayers > this.teamMaxPlayers) {
                              this.teamMaxPlayers = this.teamMinPlayers;
                            }
                            this.requestUpdate();
                          }}
                          @change=${this.handleSliderChange}
                          class="flex-1"
                        />
                        <span class="w-12 text-right"
                          >${this.teamMinPlayers}</span
                        >
                      </div>
                      <div class="flex items-center gap-4">
                        <label class="w-12 text-sm"
                          >${translateText(
                            "lobby_notification_modal.max",
                          )}</label
                        >
                        <input
                          type="range"
                          min="2"
                          max="100"
                          .value=${this.teamMaxPlayers.toString()}
                          @input=${(e: Event) => {
                            this.teamMaxPlayers = parseInt(
                              (e.target as HTMLInputElement).value,
                            );
                            if (this.teamMaxPlayers < this.teamMinPlayers) {
                              this.teamMinPlayers = this.teamMaxPlayers;
                            }
                            this.requestUpdate();
                          }}
                          @change=${this.handleSliderChange}
                          class="flex-1"
                        />
                        <span class="w-12 text-right"
                          >${this.teamMaxPlayers}</span
                        >
                      </div>
                    </div>

                    <div class="mt-4">
                      <div class="flex items-center justify-between mb-2">
                        <span class="text-sm text-gray-300"
                          >${translateText(
                            "lobby_notification_modal.team_configuration",
                          )}</span
                        >
                        <div class="flex gap-2">
                          <button
                            @click=${this.selectAllTeams}
                            class="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
                          >
                            ${translateText(
                              "lobby_notification_modal.select_all",
                            )}
                          </button>
                          <button
                            @click=${this.deselectAllTeams}
                            class="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded"
                          >
                            ${translateText(
                              "lobby_notification_modal.deselect_all",
                            )}
                          </button>
                        </div>
                      </div>

                      <div class="space-y-1 text-sm">
                        <div class="font-semibold text-blue-300 mb-1">
                          ${translateText(
                            "lobby_notification_modal.fixed_modes",
                          )}
                        </div>
                        ${FIXED_TEAM_MODES.map(
                          (mode) => html`
                            <label
                              class="flex items-center gap-2 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                .checked=${this.selectedTeamCounts.has(mode)}
                                @change=${(e: Event) =>
                                  this.handleTeamCountChange(mode, e)}
                                class="w-4 h-4"
                              />
                              <span>
                                ${(
                                  {
                                    Duos: translateText(
                                      "host_modal.teams_Duos",
                                    ),
                                    Trios: translateText(
                                      "host_modal.teams_Trios",
                                    ),
                                    Quads: translateText(
                                      "host_modal.teams_Quads",
                                    ),
                                  } as Record<string, string>
                                )[mode]}
                              </span>
                            </label>
                          `,
                        )}

                        <div class="font-semibold text-green-300 mt-2 mb-1">
                          ${translateText(
                            "lobby_notification_modal.variable_modes",
                          )}
                        </div>
                        ${VARIABLE_TEAM_COUNTS.map(
                          (count) => html`
                            <label
                              class="flex items-center gap-2 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                .checked=${this.selectedTeamCounts.has(count)}
                                @change=${(e: Event) =>
                                  this.handleTeamCountChange(count, e)}
                                class="w-4 h-4"
                              />
                              <span>
                                ${translateText("public_lobby.teams", {
                                  num: count,
                                })}
                              </span>
                            </label>
                          `,
                        )}
                      </div>
                    </div>
                  </div>
                `
              : ""}
          </div>

          <!-- Sound Settings -->
          <div class="bg-gray-800 bg-opacity-50 p-4 rounded-lg">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                .checked=${this.soundEnabled}
                @change=${this.handleSoundChange}
                class="w-5 h-5"
              />
              <span class="font-bold"
                >${translateText(
                  "lobby_notification_modal.sound_notifications",
                )}</span
              >
            </label>
          </div>

          <!-- Status Info -->
          <div
            class="bg-blue-900 bg-opacity-30 p-3 rounded-lg text-sm text-center"
          >
            ${this.isEnabled()
              ? html`<span class="text-green-400"
                  >${translateText("lobby_notification_modal.active")}</span
                >`
              : html`<span class="text-gray-400"
                  >${translateText(
                    "lobby_notification_modal.enable_hint",
                  )}</span
                >`}
          </div>
        </div>
      </o-modal>
    `;
  }
}
