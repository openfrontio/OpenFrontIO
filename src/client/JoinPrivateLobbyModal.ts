import { html, TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { copyToClipboard, translateText } from "../client/Utils";
import {
  ClientInfo,
  GameConfig,
  GameInfo,
  GameRecordSchema,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { GameMode } from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { getApiBase } from "./Api";
import { JoinLobbyEvent } from "./Main";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import "./components/LobbyChatPanel";
import "./components/LobbyTeamView";
@customElement("join-private-lobby-modal")
export class JoinPrivateLobbyModal extends BaseModal {
  @query("#lobbyIdInput") private lobbyIdInput!: HTMLInputElement;
  @state() private message: string = "";
  @state() private hasJoined = false;
  @state() private players: ClientInfo[] = [];
  @state() private gameConfig: GameConfig | null = null;
  @state() private lobbyCreatorClientID: string | null = null;
  @state() private lobbyIdVisible: boolean = true;
  @state() private copySuccess: boolean = false;
  @state() private currentLobbyId: string = "";
  @state() private chatEnabled: boolean = false;

  private playersInterval: NodeJS.Timeout | null = null;
  private userSettings: UserSettings = new UserSettings();

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
  }

  render() {
    const content = html`
      <div
        class="h-full flex flex-col bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden select-none"
      >
        <div
          class="flex items-center mb-6 pb-2 border-b border-white/10 gap-2 shrink-0 p-6"
        >
          <div class="flex items-center gap-4 flex-1">
            <button
              @click=${this.closeAndLeave}
              class="group flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 transition-all border border-white/10"
              aria-label=${translateText("common.close")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5 text-gray-400 group-hover:text-white transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
            </button>
            <span
              class="text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest break-words hyphens-auto"
            >
              ${translateText("private_lobby.title")}
            </span>
          </div>

          <!-- Lobby ID Box -->
          ${this.hasJoined
            ? html`<div
                class="flex items-center gap-0.5 bg-white/5 rounded-lg px-2 py-1 border border-white/10 max-w-[220px] flex-nowrap"
              >
                <button
                  @click=${() => {
                    this.lobbyIdVisible = !this.lobbyIdVisible;
                    this.requestUpdate();
                  }}
                  class="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                  title=${translateText("toggle_visibility")}
                >
                  ${this.lobbyIdVisible
                    ? html`<svg
                        viewBox="0 0 512 512"
                        height="16px"
                        width="16px"
                        fill="currentColor"
                      >
                        <path
                          d="M256 105c-101.8 0-188.4 62.7-224 151 35.6 88.3 122.2 151 224 151s188.4-62.7 224-151c-35.6-88.3-122.2-151-224-151zm0 251.7c-56 0-101.7-45.7-101.7-101.7S200 153.3 256 153.3 357.7 199 357.7 255 312 356.7 256 356.7zm0-161.1c-33 0-59.4 26.4-59.4 59.4s26.4 59.4 59.4 59.4 59.4-26.4 59.4-59.4-26.4-59.4-59.4-59.4z"
                        ></path>
                      </svg>`
                    : html`<svg
                        viewBox="0 0 512 512"
                        height="16px"
                        width="16px"
                        fill="currentColor"
                      >
                        <path
                          d="M448 256s-64-128-192-128S64 256 64 256c32 64 96 128 192 128s160-64 192-128z"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="32"
                        ></path>
                        <path
                          d="M144 256l224 0"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="32"
                          stroke-linecap="round"
                        ></path>
                      </svg>`}
                </button>
                <div
                  @click=${this.copyToClipboard}
                  @dblclick=${(e: Event) => {
                    (e.currentTarget as HTMLElement).classList.add(
                      "select-all",
                    );
                  }}
                  @mouseleave=${(e: Event) => {
                    (e.currentTarget as HTMLElement).classList.remove(
                      "select-all",
                    );
                  }}
                  class="font-mono text-xs font-bold text-white px-2 cursor-pointer select-none min-w-[80px] text-center truncate tracking-wider"
                  title="${translateText("common.click_to_copy")}"
                >
                  ${this.copySuccess
                    ? translateText("common.copied")
                    : this.lobbyIdVisible
                      ? this.currentLobbyId
                      : "••••••••"}
                </div>
              </div>`
            : ""}
        </div>
        <div class="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4 mr-1">
          ${!this.hasJoined
            ? html`<div class="flex flex-col gap-3">
                <div class="flex gap-2">
                  <input
                    type="text"
                    id="lobbyIdInput"
                    placeholder=${translateText("private_lobby.enter_id")}
                    @keyup=${this.handleChange}
                    class="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono text-sm tracking-wider"
                  />
                  <button
                    @click=${this.pasteFromClipboard}
                    class="px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl transition-all group"
                    title=${translateText("common.paste")}
                  >
                    <svg
                      class="text-white/60 group-hover:text-white transition-colors"
                      stroke="currentColor"
                      fill="currentColor"
                      stroke-width="0"
                      viewBox="0 0 32 32"
                      height="18px"
                      width="18px"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M 15 3 C 13.742188 3 12.847656 3.890625 12.40625 5 L 5 5 L 5 28 L 13 28 L 13 30 L 27 30 L 27 14 L 25 14 L 25 5 L 17.59375 5 C 17.152344 3.890625 16.257813 3 15 3 Z M 15 5 C 15.554688 5 16 5.445313 16 6 L 16 7 L 19 7 L 19 9 L 11 9 L 11 7 L 14 7 L 14 6 C 14 5.445313 14.445313 5 15 5 Z M 7 7 L 9 7 L 9 11 L 21 11 L 21 7 L 23 7 L 23 14 L 13 14 L 13 26 L 7 26 Z M 15 16 L 25 16 L 25 28 L 15 28 Z"
                      ></path>
                    </svg>
                  </button>
                </div>
                <o-button
                  title=${translateText("private_lobby.join_lobby")}
                  block
                  @click=${this.joinLobby}
                ></o-button>
              </div>`
            : ""}
          ${this.renderGameConfig()}
          ${this.hasJoined && this.players.length > 0
            ? html`
                <div class="mt-6 border-t border-white/10 pt-6">
                  <div class="flex justify-between items-center mb-4">
                    <div
                      class="text-xs font-bold text-white/40 uppercase tracking-widest"
                    >
                      ${this.players.length}
                      ${this.players.length === 1
                        ? translateText("private_lobby.player")
                        : translateText("private_lobby.players")}
                    </div>
                  </div>

                  <lobby-team-view
                    class="block rounded-lg border border-white/10 bg-white/5 p-2"
                    .gameMode=${this.gameConfig?.gameMode ?? GameMode.FFA}
                    .clients=${this.players}
                    .lobbyCreatorClientID=${this.lobbyCreatorClientID}
                    .teamCount=${this.gameConfig?.playerTeams ?? 2}
                  ></lobby-team-view>

                  ${this.chatEnabled
                    ? html`
                        <div
                          class="mt-4 p-3 rounded-lg border border-white/10 bg-white/5"
                        >
                          <div class="text-sm font-semibold text-white/80 mb-2">
                            ${translateText("lobby_chat.title")}
                          </div>
                          <lobby-chat-panel></lobby-chat-panel>
                        </div>
                      `
                    : ""}
                </div>
              `
            : ""}
        </div>

        ${this.hasJoined && this.players.length > 0
          ? html` <div
              class="p-6 pt-4 border-t border-white/10 bg-black/20 shrink-0"
            >
              <button
                class="w-full py-4 text-sm font-bold text-white uppercase tracking-widest bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5 active:translate-y-0 disabled:transform-none"
                disabled
              >
                ${translateText("private_lobby.joined_waiting")}
              </button>
            </div>`
          : ""}
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        ?hideHeader=${true}
        ?hideCloseButton=${true}
        ?inline=${this.inline}
      >
        ${content}
      </o-modal>
    `;
  }

  private renderConfigItem(
    label: string,
    value: string | TemplateResult,
  ): TemplateResult {
    return html`
      <div
        class="bg-white/5 border border-white/10 rounded-lg p-3 flex flex-col items-center justify-center gap-1 text-center min-w-[100px]"
      >
        <span
          class="text-white/40 text-[10px] font-bold uppercase tracking-wider"
          >${label}</span
        >
        <span
          class="text-white font-bold text-sm w-full break-words hyphens-auto"
          >${value}</span
        >
      </div>
    `;
  }

  private renderGameConfig(): TemplateResult {
    if (!this.gameConfig) return html``;

    const c = this.gameConfig;
    const mapName = translateText(
      "map." + c.gameMap.toLowerCase().replace(/ /g, ""),
    );
    const modeName =
      c.gameMode === "Free For All"
        ? translateText("game_mode.ffa")
        : translateText("game_mode.teams");
    const diffName = translateText(
      "difficulty." + c.difficulty.toLowerCase().replace(/ /g, ""),
    );

    return html`
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        ${this.renderConfigItem(translateText("map.map"), mapName)}
        ${this.renderConfigItem(translateText("host_modal.mode"), modeName)}
        ${this.renderConfigItem(
          translateText("difficulty.difficulty"),
          diffName,
        )}
        ${this.renderConfigItem(
          translateText("host_modal.bots"),
          c.bots.toString(),
        )}
        ${c.gameMode !== "Free For All" && c.playerTeams
          ? this.renderConfigItem(
              typeof c.playerTeams === "string"
                ? translateText("host_modal.team_type")
                : translateText("host_modal.team_count"),
              typeof c.playerTeams === "string"
                ? translateText("host_modal.teams_" + c.playerTeams)
                : c.playerTeams.toString(),
            )
          : html``}
      </div>
      ${this.renderDisabledUnits()}
    `;
  }

  private renderDisabledUnits(): TemplateResult {
    if (
      !this.gameConfig ||
      !this.gameConfig.disabledUnits ||
      this.gameConfig.disabledUnits.length === 0
    ) {
      return html``;
    }

    const unitKeys: Record<string, string> = {
      City: "unit_type.city",
      Port: "unit_type.port",
      "Defense Post": "unit_type.defense_post",
      "SAM Launcher": "unit_type.sam_launcher",
      "Missile Silo": "unit_type.missile_silo",
      Warship: "unit_type.warship",
      Factory: "unit_type.factory",
      "Atom Bomb": "unit_type.atom_bomb",
      "Hydrogen Bomb": "unit_type.hydrogen_bomb",
      MIRV: "unit_type.mirv",
      "Trade Ship": "stats_modal.unit.trade",
      Transport: "stats_modal.unit.trans",
      "MIRV Warhead": "stats_modal.unit.mirvw",
    };

    return html`
      <div class="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
        <div
          class="text-xs font-bold text-red-400 uppercase tracking-widest mb-2"
        >
          ${translateText("private_lobby.disabled_units")}
        </div>
        <div class="flex flex-wrap gap-2">
          ${this.gameConfig.disabledUnits.map((unit) => {
            const key = unitKeys[unit];
            const name = key ? translateText(key) : unit;
            return html`
              <span
                class="px-2 py-1 bg-red-500/20 text-red-200 text-xs rounded font-bold border border-red-500/30"
              >
                ${name}
              </span>
            `;
          })}
        </div>
      </div>
    `;
  }

  public open(id: string = "") {
    super.open();
    this.lobbyIdVisible = this.userSettings.get(
      "settings.lobbyIdVisibility",
      true,
    );
    if (id) {
      this.setLobbyId(id);
      this.joinLobby();
    }
  }

  protected onClose(): void {
    if (this.lobbyIdInput) this.lobbyIdInput.value = "";
    this.currentLobbyId = "";
    this.gameConfig = null;
    this.players = [];
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
  }

  public closeAndLeave() {
    this.close();
    this.hasJoined = false;
    this.message = "";
    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.currentLobbyId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async copyToClipboard() {
    await copyToClipboard(
      `${location.origin}/#join=${this.currentLobbyId}`,
      () => (this.copySuccess = true),
      () => (this.copySuccess = false),
    );
  }

  private isValidLobbyId(value: string): boolean {
    return /^[a-zA-Z0-9]{8}$/.test(value);
  }

  private normalizeLobbyId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const extracted = this.extractLobbyIdFromUrl(trimmed).trim();
    if (!this.isValidLobbyId(extracted)) return null;
    return extracted;
  }

  private sanitizeForLog(value: string): string {
    return value.replace(/[\r\n]/g, "");
  }

  private extractLobbyIdFromUrl(input: string): string {
    if (input.startsWith("http")) {
      if (input.includes("#join=")) {
        const params = new URLSearchParams(input.split("#")[1]);
        return params.get("join") ?? input;
      } else if (input.includes("join/")) {
        return input.split("join/")[1];
      } else {
        return input;
      }
    } else {
      return input;
    }
  }

  private setLobbyId(id: string) {
    this.lobbyIdInput.value = this.extractLobbyIdFromUrl(id);
  }

  private handleChange(e: Event) {
    const value = (e.target as HTMLInputElement).value.trim();
    this.setLobbyId(value);
  }

  private async pasteFromClipboard() {
    try {
      const clipText = await navigator.clipboard.readText();
      this.setLobbyId(clipText);
    } catch (err) {
      console.error("Failed to read clipboard contents: ", err);
    }
  }

  private async joinLobby(): Promise<void> {
    const lobbyId = this.normalizeLobbyId(this.lobbyIdInput.value);
    if (!lobbyId) {
      this.showMessage(translateText("private_lobby.not_found"), "red");
      return;
    }

    this.lobbyIdInput.value = lobbyId;
    this.currentLobbyId = lobbyId;
    console.log(`Joining lobby with ID: ${this.sanitizeForLog(lobbyId)}`);

    try {
      // First, check if the game exists in active lobbies
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (gameExists) return;

      // If not active, check archived games
      switch (await this.checkArchivedGame(lobbyId)) {
        case "success":
          return;
        case "not_found":
          this.showMessage(translateText("private_lobby.not_found"), "red");
          this.message = "";
          return;
        case "version_mismatch":
          this.showMessage(
            translateText("private_lobby.version_mismatch"),
            "red",
          );
          this.message = "";
          return;
        case "error":
          this.showMessage(translateText("private_lobby.error"), "red");
          this.message = "";
          return;
      }
    } catch (error) {
      console.error("Error checking lobby existence:", error);
      this.showMessage(translateText("private_lobby.error"), "red");
      this.message = "";
    }
  }

  private showMessage(message: string, color: "green" | "red" = "green") {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: { message, duration: 3000, color },
      }),
    );
  }

  private async checkActiveLobby(lobbyId: string): Promise<boolean> {
    const config = await getServerConfigFromClient();
    const url = `/${config.workerPath(lobbyId)}/api/game/${lobbyId}/exists`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const gameInfo = await response.json();

    if (gameInfo.exists) {
      this.showMessage(translateText("private_lobby.joined_waiting"));
      this.message = "";
      this.hasJoined = true;

      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            clientID: generateID(),
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );

      this.pollPlayers();
      this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
      return true;
    }

    return false;
  }

  private async checkArchivedGame(
    lobbyId: string,
  ): Promise<"success" | "not_found" | "version_mismatch" | "error"> {
    const archivePromise = fetch(`${getApiBase()}/game/${lobbyId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const gitCommitPromise = fetch(`/commit.txt`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-cache",
    });

    const [archiveResponse, gitCommitResponse] = await Promise.all([
      archivePromise,
      gitCommitPromise,
    ]);

    if (archiveResponse.status === 404) {
      return "not_found";
    }
    if (archiveResponse.status !== 200) {
      return "error";
    }

    const archiveData = await archiveResponse.json();
    const parsed = GameRecordSchema.safeParse(archiveData);
    if (!parsed.success) {
      return "version_mismatch";
    }

    let myGitCommit = "";
    if (gitCommitResponse.status === 404) {
      // commit.txt is not found when running locally
      myGitCommit = "DEV";
    } else if (gitCommitResponse.status === 200) {
      myGitCommit = (await gitCommitResponse.text()).trim();
    } else {
      console.error("Error getting git commit:", gitCommitResponse.status);
      return "error";
    }

    // Allow DEV to join games created with a different version for debugging.
    if (myGitCommit !== "DEV" && parsed.data.gitCommit !== myGitCommit) {
      const safeLobbyId = this.sanitizeForLog(lobbyId);
      console.warn(
        `Git commit hash mismatch for game ${safeLobbyId}`,
        archiveData.details,
      );
      return "version_mismatch";
    }

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobbyId,
          gameRecord: parsed.data,
          clientID: generateID(),
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    return "success";
  }

  private async pollPlayers() {
    const lobbyId = this.currentLobbyId;
    if (!lobbyId) return;
    const config = await getServerConfigFromClient();

    fetch(`/${config.workerPath(lobbyId)}/api/game/${lobbyId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((data: GameInfo) => {
        this.lobbyCreatorClientID = data.clients?.[0]?.clientID ?? null;
        this.players = data.clients ?? [];
        if (data.gameConfig) {
          this.gameConfig = data.gameConfig;
          this.chatEnabled = data.gameConfig.chatEnabled ?? false;
        }
      })
      .catch((error) => {
        console.error("Error polling players:", error);
      });
  }
}
