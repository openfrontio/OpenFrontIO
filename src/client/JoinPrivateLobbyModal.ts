import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { GameConfig, GameInfo, GameRecordSchema } from "../core/Schemas";
import { generateID } from "../core/Util";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import { getApiBase } from "./Api";
import { JoinLobbyEvent } from "./Main";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
@customElement("join-private-lobby-modal")
export class JoinPrivateLobbyModal extends LitElement {
  @property({ type: Boolean }) inline = false;
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @query("#lobbyIdInput") private lobbyIdInput!: HTMLInputElement;
  @state() private message: string = "";
  @state() private hasJoined = false;
  @state() private players: string[] = [];
  @state() private gameConfig: GameConfig | null = null;

  private playersInterval: NodeJS.Timeout | null = null;

  connectedCallback() {
    super.connectedCallback();
    if (this.hasAttribute("inline")) {
      this.inline = true;
    }
    window.addEventListener("keydown", this.handleKeyDown);
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
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

  render() {
    const content = html`
      <div
        class="h-full flex flex-col bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 shadow-xl overflow-hidden"
      >
        <div
          class="flex items-center mb-6 pb-2 border-b border-white/10 gap-2 shrink-0 p-6"
        >
          <div class="flex items-center gap-4 flex-1">
            <button
              @click=${this.close}
              class="group flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 transition-all border border-white/10"
              aria-label="Back"
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
              class="text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest"
            >
              ${translateText("private_lobby.title")}
            </span>
          </div>
        </div>
        <div class="lobby-id-box">
          <input
            type="text"
            id="lobbyIdInput"
            placeholder=${translateText("private_lobby.enter_id")}
            @keyup=${this.handleChange}
          />
          <button
            @click=${this.pasteFromClipboard}
            class="lobby-id-paste-button"
          >
            <svg
              class="lobby-id-paste-button-icon"
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
        <div class="message-area ${this.message ? "show" : ""}">
          ${this.message}
        </div>

        ${this.renderGameConfig()}

        <div class="options-layout">
          ${this.hasJoined && this.players.length > 0
            ? html` <div class="options-section">
                <div class="option-title">
                  ${this.players.length}
                  ${this.players.length === 1
                    ? translateText("private_lobby.player")
                    : translateText("private_lobby.players")}
                </div>

                <div class="players-list">
                  ${this.players.map(
                    (player) => html`<span class="player-tag">${player}</span>`,
                  )}
                </div>
              </div>`
            : ""}
        </div>
        <div class="flex justify-center">
          ${!this.hasJoined
            ? html` <o-button
                title=${translateText("private_lobby.join_lobby")}
                block
                @click=${this.joinLobby}
              ></o-button>`
            : ""}
        </div>
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
        <span class="text-white font-bold text-sm truncate w-full"
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
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 px-6 mb-6">
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
        ${c.playerTeams
          ? this.renderConfigItem(
              translateText("host_modal.team_count"),
              c.playerTeams.toString(),
            )
          : html``}
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }

  public open(id: string = "") {
    if (!this.inline) {
      this.modalEl?.open();
    }
    if (id) {
      this.setLobbyId(id);
      this.joinLobby();
    }
  }

  public close() {
    this.lobbyIdInput.value = "";
    this.gameConfig = null;
    this.players = [];
    if (this.inline) {
      if ((window as any).showPage) {
        (window as any).showPage("page-play");
      }
    } else {
      this.modalEl?.close();
    }
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
        detail: { lobby: this.lobbyIdInput.value },
        bubbles: true,
        composed: true,
      }),
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
      this.message = translateText("private_lobby.not_found");
      return;
    }

    this.lobbyIdInput.value = lobbyId;
    console.log(`Joining lobby with ID: ${this.sanitizeForLog(lobbyId)}`);
    this.message = `${translateText("private_lobby.checking")}`;

    try {
      // First, check if the game exists in active lobbies
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (gameExists) return;

      // If not active, check archived games
      switch (await this.checkArchivedGame(lobbyId)) {
        case "success":
          return;
        case "not_found":
          this.message = `${translateText("private_lobby.not_found")}`;
          return;
        case "version_mismatch":
          this.message = `${translateText("private_lobby.version_mismatch")}`;
          return;
        case "error":
          this.message = `${translateText("private_lobby.error")}`;
          return;
      }
    } catch (error) {
      console.error("Error checking lobby existence:", error);
      this.message = `${translateText("private_lobby.error")}`;
    }
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
      this.message = translateText("private_lobby.joined_waiting");
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
    const lobbyId = this.normalizeLobbyId(this.lobbyIdInput.value);
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
        this.players = data.clients?.map((p) => p.username) ?? [];
        if (data.gameConfig) {
          this.gameConfig = data.gameConfig;
        }
      })
      .catch((error) => {
        console.error("Error polling players:", error);
      });
  }
}
