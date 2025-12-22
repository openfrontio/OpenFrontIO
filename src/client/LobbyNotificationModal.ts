import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "./Utils";

export interface LobbyNotificationCriteria {
  gameMode: "FFA" | "Team";
  minPlayers?: number;
  maxPlayers?: number;
  teamCounts?: Array<string | number>;
}

@customElement("lobby-notification-modal")
export class LobbyNotificationModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private ffaEnabled = false;
  @state() private teamEnabled = false;
  @state() private soundEnabled = true;
  @state() private minTeamCount = 2;
  @state() private maxTeamCount = 50;

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
        this.minTeamCount = settings.minTeamCount ?? 2;
        this.maxTeamCount = settings.maxTeamCount ?? 50;
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
        minTeamCount: this.minTeamCount,
        maxTeamCount: this.maxTeamCount,
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
      });
    }

    if (this.teamEnabled) {
      criteria.push({
        gameMode: "Team",
        teamCounts: [this.minTeamCount, this.maxTeamCount],
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

  private handleSliderChange() {
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
                    <div class="mt-4">
                      <div class="text-sm text-gray-300 mb-2 font-semibold">
                        ${translateText(
                          "lobby_notification_modal.team_count_range",
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
                              max="50"
                              .value=${this.minTeamCount.toString()}
                              @input=${(e: Event) => {
                                this.minTeamCount = parseInt(
                                  (e.target as HTMLInputElement).value,
                                );
                                if (this.minTeamCount > this.maxTeamCount) {
                                  this.maxTeamCount = this.minTeamCount;
                                }
                                this.requestUpdate();
                              }}
                              @change=${this.handleSliderChange}
                              class="flex-1"
                            />
                            <span class="w-12 text-right"
                              >${this.minTeamCount}</span
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
                              max="50"
                              .value=${this.maxTeamCount.toString()}
                              @input=${(e: Event) => {
                                this.maxTeamCount = parseInt(
                                  (e.target as HTMLInputElement).value,
                                );
                                if (this.maxTeamCount < this.minTeamCount) {
                                  this.minTeamCount = this.maxTeamCount;
                                }
                                this.requestUpdate();
                              }}
                              @change=${this.handleSliderChange}
                              class="flex-1"
                            />
                            <span class="w-12 text-right"
                              >${this.maxTeamCount}</span
                            >
                          </div>
                        </div>
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
          ${!this.isEnabled()
            ? html`<div
                class="bg-blue-900 bg-opacity-30 p-3 rounded-lg text-sm text-center"
              >
                <span class="text-gray-400"
                  >${translateText(
                    "lobby_notification_modal.enable_hint",
                  )}</span
                >
              </div>`
            : ""}
        </div>
      </o-modal>
    `;
  }
}
