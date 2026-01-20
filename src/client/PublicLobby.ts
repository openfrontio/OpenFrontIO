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
  private debounceDelay: number = 150;
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

    const modifierLabel = this.getModifierLabels(
      lobby.gameConfig.publicGameModifiers,
    );

    const mapImageSrc = this.mapImages.get(lobby.gameID);

    return html`
      <button
        @click=${() => this.lobbyClicked(lobby)}
        ?disabled=${this.isButtonDebounced}
        class="group relative isolate flex flex-col w-full h-80 lg:h-96 overflow-hidden rounded-2xl transition-all duration-200 bg-[#3d7bab] ${this
          .isLobbyHighlighted
          ? "ring-2 ring-blue-600 scale-[1.01] opacity-70"
          : "hover:scale-[1.01]"} active:scale-[0.98] ${this.isButtonDebounced
          ? "cursor-not-allowed"
          : ""}"
      >
        <div class="font-sans w-full h-full flex flex-col">
          <!-- Main card gradient - stops before text -->
          <div class="absolute inset-0 pointer-events-none z-10"></div>

          <!-- Map Image Area with gradient overlay -->
          <div class="flex-1 w-full relative overflow-hidden">
            ${mapImageSrc
              ? html`<img
                  src="${mapImageSrc}"
                  alt="${lobby.gameConfig.gameMap}"
                  class="absolute inset-0 w-full h-full object-cover object-center z-10"
                />`
              : ""}
            <!-- Vignette overlay for dark edges -->
            <div class="pointer-events-none absolute inset-0 z-20"></div>
          </div>

          <!-- Mode Badge in top left -->
          ${fullModeLabel
            ? html`<span
                class="absolute top-4 left-4 px-4 py-1 rounded font-bold text-sm lg:text-base uppercase tracking-widest z-30 bg-slate-800 text-white ring-1 ring-white/10 shadow-sm"
              >
                ${fullModeLabel}
              </span>`
            : ""}

          <!-- Timer in top right -->
          ${timeRemaining > 0
            ? html`
                <span
                  class="absolute top-4 right-4 px-4 py-1 rounded font-bold text-sm lg:text-base tracking-widest z-30 bg-blue-600 text-white"
                >
                  ${timeDisplay}
                </span>
              `
            : html`<span
                class="absolute top-4 right-4 px-4 py-1 rounded font-bold text-sm lg:text-base uppercase tracking-widest z-30 bg-green-600 text-white"
              >
                ${translateText("public_lobby.started")}
              </span>`}

          <!-- Content Banner -->
          <div class="absolute bottom-0 left-0 right-0 z-20">
            <!-- Modifier badges placed just above the gradient overlay -->
            ${modifierLabel.length > 0
              ? html`<div
                  class="absolute -top-8 left-4 z-30 flex gap-2 flex-wrap"
                >
                  ${modifierLabel.map(
                    (label) => html`
                      <span
                        class="px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wide bg-purple-600 text-white"
                      >
                        ${label}
                      </span>
                    `,
                  )}
                </div>`
              : html``}

            <!-- Gradient overlay for text area - adds extra darkening -->
            <div
              class="absolute inset-0 bg-gradient-to-b from-black/60 to-black/90 pointer-events-none"
            ></div>

            <div class="relative p-6 flex flex-col gap-2 text-left">
              <!-- Header row: Status/Join on left, Player Count on right -->
              <div class="flex items-center justify-between w-full">
                <div class="text-base uppercase tracking-widest text-white">
                  ${this.currLobby
                    ? isStarting
                      ? html`<span class="text-green-400 animate-pulse"
                          >${translateText("public_lobby.starting_game")}</span
                        >`
                      : html`<span class="text-orange-400"
                          >${translateText("public_lobby.waiting_for_players")}
                          ${[0, 1, 2]
                            .map((i) =>
                              i === this.joiningDotIndex ? "•" : "·",
                            )
                            .join("")}</span
                        >`
                    : html`${translateText("public_lobby.join")}`}
                </div>

                <div class="flex items-center gap-2 text-white z-30">
                  <span class="text-base font-bold uppercase tracking-widest"
                    >${lobby.numClients}/${lobby.gameConfig.maxPlayers}</span
                  >
                  <svg
                    class="w-5 h-5 text-white"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
                    ></path>
                  </svg>
                </div>
              </div>

              <!-- Map Name - Full Width -->
              <div
                class="text-2xl lg:text-3xl font-bold text-white leading-none uppercase tracking-widest w-full"
              >
                ${translateText(
                  `map.${lobby.gameConfig.gameMap.toLowerCase().replace(/[\s.]+/g, "")}`,
                )}
              </div>

              <!-- modifiers moved above gradient overlay -->
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
    if (publicGameModifiers.isCrowded) {
      labels.push(translateText("public_game_modifier.crowded"));
    }
    if (publicGameModifiers.startingGold) {
      labels.push(translateText("public_game_modifier.starting_gold"));
    }
    return labels;
  }

  private lobbyClicked(lobby: GameInfo) {
    if (this.isButtonDebounced) return;

    this.isButtonDebounced = true;
    setTimeout(() => {
      this.isButtonDebounced = false;
    }, this.debounceDelay);

    if (this.currLobby === null) {
      // Validate username only when joining a new lobby
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

      this.isLobbyHighlighted = true;
      this.currLobby = lobby;
      this.startJoiningAnimation();
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobby.gameID,
            clientID: generateID(),
            source: "public",
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
