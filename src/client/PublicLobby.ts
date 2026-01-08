import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { renderDuration, translateText } from "../client/Utils";
import {
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  PublicGameModifiers,
  Quads,
  Trios,
} from "../core/game/Game";
import { GameID, GameInfo } from "../core/Schemas";
import { generateID } from "../core/Util";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

@customElement("public-lobby")
export class PublicLobby extends LitElement {
  @state() private lobbies: GameInfo[] = [];
  @state() public isLobbyHighlighted: boolean = false;
  @state() private isButtonDebounced: boolean = false;
  @state() private mapImages: Map<GameID, string> = new Map();
  @state() private joiningDotIndex: number = 0;

  private joiningInterval: number | null = null;
  private currLobby: GameInfo | null = null;
  private debounceDelay: number = 750;
  private lobbyIDToStart = new Map<GameID, number>();
  private lobbySocket = new PublicLobbySocket((lobbies) =>
    this.handleLobbiesUpdate(lobbies),
  );

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.lobbySocket.start();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.lobbySocket.stop();
    this.stopJoiningAnimation();
  }

  private handleLobbiesUpdate(lobbies: GameInfo[]) {
    this.lobbies = lobbies;
    this.lobbies.forEach((l) => {
      if (!this.lobbyIDToStart.has(l.gameID)) {
        const msUntilStart = l.msUntilStart ?? 0;
        this.lobbyIDToStart.set(l.gameID, msUntilStart + Date.now());
      }

      if (l.gameConfig && !this.mapImages.has(l.gameID)) {
        this.loadMapImage(l.gameID, l.gameConfig.gameMap);
      }
    });
    this.requestUpdate();
  }

  private async loadMapImage(gameID: GameID, gameMap: string) {
    try {
      const mapType = gameMap as GameMapType;
      const data = terrainMapFileLoader.getMapData(mapType);
      this.mapImages.set(gameID, await data.webpPath());
      this.requestUpdate();
    } catch (error) {
      console.error("Failed to load map image:", error);
    }
  }

  render() {
    if (this.lobbies.length === 0) return html``;

    const lobby = this.lobbies[0];
    if (!lobby?.gameConfig) return html``;

    const start = this.lobbyIDToStart.get(lobby.gameID) ?? 0;
    const timeRemaining = Math.max(0, Math.floor((start - Date.now()) / 1000));
    const isStarting = timeRemaining <= 2;
    const timeDisplay = renderDuration(timeRemaining);

    const teamCount =
      lobby.gameConfig.gameMode === GameMode.Team
        ? (lobby.gameConfig.playerTeams ?? 0)
        : null;

    const maxPlayers = lobby.gameConfig.maxPlayers ?? 0;
    const teamSize = this.getTeamSize(teamCount, maxPlayers);
    const teamTotal = this.getTeamTotal(teamCount, teamSize, maxPlayers);
    const modeLabel = this.getModeLabel(
      lobby.gameConfig.gameMode,
      teamCount,
      teamTotal,
      teamSize,
    );
    // True when the detail label already includes the full mode text.
    const { label: teamDetailLabel, isFullLabel: isTeamDetailFullLabel } =
      this.getTeamDetailLabel(
        lobby.gameConfig.gameMode,
        teamCount,
        teamTotal,
        teamSize,
      );

    let fullModeLabel = modeLabel;
    if (teamDetailLabel) {
      fullModeLabel = isTeamDetailFullLabel
        ? teamDetailLabel
        : `${modeLabel} ${teamDetailLabel}`;
    }

    const mapImageSrc = this.mapImages.get(lobby.gameID);

    return html`
      <button
        @click=${() => this.lobbyClicked(lobby)}
        ?disabled=${this.isButtonDebounced}
        class="group relative isolate flex flex-col w-full h-80 lg:h-96 overflow-hidden rounded-2xl transition-all duration-300 ${this
          .isLobbyHighlighted
          ? "ring-2 ring-green-500 scale-[1.01] opacity-70"
          : "hover:scale-[1.01] hover:border-white/30"} ${this.isButtonDebounced
          ? "opacity-70 cursor-not-allowed"
          : ""}"
      >
        <!-- Map Image Area -->
        <div class="flex-1 w-full relative overflow-hidden bg-blue-500/85 p-8">
          ${mapImageSrc
            ? html`<img
                src="${mapImageSrc}"
                alt="${lobby.gameConfig.gameMap}"
                class="w-full h-full object-contain transition-transform duration-700 group-hover:scale-105 filter drop-shadow-2xl"
              />`
            : html`<div class="w-full h-full bg-gray-800 rounded-lg"></div>`}
        </div>

        <!-- Content Banner -->
        <div
          class="relative w-full p-5 flex flex-col gap-1 text-left z-10 bg-slate-900/95 backdrop-blur-xl border-t border-white/10"
        >
          <div class="flex justify-between items-end w-full">
            <div class="flex flex-col gap-1">
              <!-- Header: Status or Join -->
              <div
                class="text-sm font-bold uppercase tracking-widest text-blue-400 mb-1"
              >
                ${this.currLobby
                  ? isStarting
                    ? html`<span class="text-green-400 animate-pulse"
                        >${translateText("public_lobby.starting_game")}</span
                      >`
                    : html`${translateText("public_lobby.waiting_for_players")}
                      ${[0, 1, 2]
                        .map((i) => (i === this.joiningDotIndex ? "•" : "·"))
                        .join("")}`
                  : html`<span
                      class="group-hover:text-blue-300 transition-colors"
                      >${translateText("public_lobby.join")}</span
                    >`}
              </div>

              <!-- Map Name & Mode -->
              <div
                class="text-3xl font-black text-white leading-none tracking-tight"
              >
                ${translateText(
                  `map.${lobby.gameConfig.gameMap.toLowerCase().replace(/[\s.]+/g, "")}`,
                )}
              </div>
              <div class="flex flex-wrap items-center gap-2 mt-2">
                ${fullModeLabel
                  ? html`<span
                      class="px-2 py-1 rounded text-xs font-bold uppercase tracking-wider bg-white/10 text-white border border-white/10 backdrop-blur-sm"
                    >
                      ${fullModeLabel}
                    </span>`
                  : ""}
              </div>
            </div>

            <!-- Player Count & Time -->
            <div class="flex flex-col items-end gap-1">
              <div class="flex items-center gap-2">
                <span class="text-2xl font-bold text-white"
                  >${lobby.numClients}/${lobby.gameConfig.maxPlayers}</span
                >
                <svg
                  class="w-5 h-5 text-white/50"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
                  ></path>
                </svg>
              </div>
              ${timeRemaining > 0
                ? html`
                    <div
                      class="text-sm font-mono font-medium text-blue-200 bg-blue-500/20 px-2 py-0.5 rounded border border-blue-500/30"
                    >
                      ${timeDisplay}
                    </div>
                  `
                : html`<div
                    class="text-sm font-bold text-green-200 bg-green-500/20 border border-green-500/30 px-2 py-0.5 rounded uppercase tracking-wider"
                  >
                    ${translateText("public_lobby.started")}
                  </div>`}
            </div>
          </div>
        </div>
      </button>
    `;
  }

  leaveLobby() {
    this.isLobbyHighlighted = false;
    this.currLobby = null;
    this.stopJoiningAnimation();
  }

  public stop() {
    this.lobbySocket.stop();
    this.isLobbyHighlighted = false;
    this.currLobby = null;
    this.stopJoiningAnimation();
  }

  private startJoiningAnimation() {
    if (this.joiningInterval !== null) return;

    this.joiningDotIndex = 0;
    this.joiningInterval = window.setInterval(() => {
      this.joiningDotIndex = (this.joiningDotIndex + 1) % 3;
    }, 500);
  }

  private stopJoiningAnimation() {
    if (this.joiningInterval !== null) {
      clearInterval(this.joiningInterval);
      this.joiningInterval = null;
    }
    this.joiningDotIndex = 0;
  }

  private getTeamSize(
    teamCount: number | string | null,
    maxPlayers: number,
  ): number | undefined {
    if (typeof teamCount === "string") {
      if (teamCount === Duos) return 2;
      if (teamCount === Trios) return 3;
      if (teamCount === Quads) return 4;
      if (teamCount === HumansVsNations) return maxPlayers;
      return undefined;
    }
    if (typeof teamCount === "number" && teamCount > 0) {
      return Math.floor(maxPlayers / teamCount);
    }
    return undefined;
  }

  private getTeamTotal(
    teamCount: number | string | null,
    teamSize: number | undefined,
    maxPlayers: number,
  ): number | undefined {
    if (typeof teamCount === "number") return teamCount;
    if (teamCount === HumansVsNations) return 2;
    if (teamSize && teamSize > 0) return Math.floor(maxPlayers / teamSize);
    return undefined;
  }

  private getModeLabel(
    gameMode: GameMode,
    teamCount: number | string | null,
    teamTotal: number | undefined,
    teamSize: number | undefined,
  ): string {
    if (gameMode !== GameMode.Team) return translateText("game_mode.ffa");
    if (teamCount === HumansVsNations && teamSize !== undefined)
      return translateText("public_lobby.teams_hvn_detailed", {
        num: teamSize,
      });
    const totalTeams =
      teamTotal ?? (typeof teamCount === "number" ? teamCount : 0);
    return translateText("public_lobby.teams", { num: totalTeams });
  }

  private getTeamDetailLabel(
    gameMode: GameMode,
    teamCount: number | string | null,
    teamTotal: number | undefined,
    teamSize: number | undefined,
  ): { label: string | null; isFullLabel: boolean } {
    if (gameMode !== GameMode.Team) {
      return { label: null, isFullLabel: false };
    }

    if (typeof teamCount === "string" && teamCount === HumansVsNations) {
      return { label: null, isFullLabel: false };
    }

    if (typeof teamCount === "string") {
      const teamKey = `public_lobby.teams_${teamCount}`;
      // translateText returns the key when a translation is missing.
      const maybeTranslated = translateText(teamKey, {
        team_count: teamTotal ?? 0,
      });
      if (maybeTranslated !== teamKey) {
        return { label: maybeTranslated, isFullLabel: true };
      }
    }

    if (teamTotal !== undefined && teamSize !== undefined) {
      // Fallback when there's no specific team label translation.
      return {
        label: translateText("public_lobby.players_per_team", {
          num: teamSize,
        }),
        isFullLabel: false,
      };
    }

    return { label: null, isFullLabel: false };
  }

  private getModifierLabels(
    publicGameModifiers: PublicGameModifiers | undefined,
  ): string[] {
    if (!publicGameModifiers) {
      return [];
    }
    const labels: string[] = [];
    if (publicGameModifiers.isRandomSpawn) {
      labels.push(translateText("public_game_modifier.random_spawn"));
    }
    if (publicGameModifiers.isCompact) {
      labels.push(translateText("public_game_modifier.compact_map"));
    }
    return labels;
  }

  private lobbyClicked(lobby: GameInfo) {
    if (this.isButtonDebounced) return;

    const usernameInput = document.querySelector("username-input") as any;
    if (
      usernameInput &&
      typeof usernameInput.isValid === "function" &&
      !usernameInput.isValid()
    ) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: usernameInput.validationError,
            color: "red",
            duration: 3000,
          },
        }),
      );
      return;
    }

    this.isButtonDebounced = true;
    setTimeout(() => {
      this.isButtonDebounced = false;
    }, this.debounceDelay);

    if (this.currLobby === null) {
      this.isLobbyHighlighted = true;
      this.currLobby = lobby;
      this.startJoiningAnimation();
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobby.gameID,
            clientID: generateID(),
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this.dispatchEvent(
        new CustomEvent("leave-lobby", {
          detail: { lobby: this.currLobby },
          bubbles: true,
          composed: true,
        }),
      );
      this.leaveLobby();
    }
  }
}
