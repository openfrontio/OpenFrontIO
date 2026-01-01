import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { renderDuration, translateText } from "../client/Utils";
import {
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
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
    const teamDetailLabel = this.getTeamDetailLabel(
      lobby.gameConfig.gameMode,
      teamCount,
      teamTotal,
      teamSize,
    );

    const fullModeLabel = teamDetailLabel
      ? `${modeLabel} ${teamDetailLabel}`
      : modeLabel;

    const mapImageSrc = this.mapImages.get(lobby.gameID);

    return html`
      <button
        @click=${() => this.lobbyClicked(lobby)}
        ?disabled=${this.isButtonDebounced}
        class="isolate grid h-40 grid-cols-[100%] grid-rows-[100%] place-content-stretch w-full overflow-hidden ${this
          .isLobbyHighlighted
          ? "bg-gradient-to-r from-green-600 to-green-500"
          : "bg-gradient-to-r from-blue-600 to-blue-500"} text-white font-medium rounded-xl transition-opacity duration-200 hover:opacity-90 ${this
          .isButtonDebounced
          ? "opacity-70 cursor-not-allowed"
          : ""}"
      >
        ${mapImageSrc
          ? html`<img
              src="${mapImageSrc}"
              alt="${lobby.gameConfig.gameMap}"
              class="place-self-start col-span-full row-span-full h-full -z-10"
              style="mask-image: linear-gradient(to left, transparent, #fff)"
            />`
          : html`<div
              class="place-self-start col-span-full row-span-full h-full -z-10 bg-gray-300"
            ></div>`}
        <div
          class="flex flex-col justify-between h-full col-span-full row-span-full p-4 md:p-6 text-right z-0"
        >
          <div>
            <div class="text-lg md:text-2xl font-semibold">
              ${this.currLobby
                ? isStarting
                  ? html`${translateText("public_lobby.starting_game")}`
                  : html`${translateText("public_lobby.waiting_for_players")}
                    ${[0, 1, 2]
                      .map((i) => (i === this.joiningDotIndex ? "•" : "·"))
                      .join("")}`
                : translateText("public_lobby.join")}
            </div>
            <div class="text-md font-medium text-white-400">
              ${fullModeLabel
                ? html`<span
                    class="text-sm ${this.isLobbyHighlighted
                      ? "text-green-600"
                      : "text-blue-600"} bg-white rounded-sm px-1 ml-1"
                    >${fullModeLabel}</span
                  >`
                : ""}
              <span
                >${translateText(
                  `map.${lobby.gameConfig.gameMap.toLowerCase().replace(/[\s.]+/g, "")}`,
                )}</span
              >
            </div>
          </div>

          <div>
            <div class="text-md font-medium text-blue-100">
              ${lobby.numClients} / ${lobby.gameConfig.maxPlayers}
            </div>
            <div class="text-md font-medium text-blue-100">${timeDisplay}</div>
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
  ): string | null {
    if (gameMode !== GameMode.Team) return null;

    if (typeof teamCount === "string" && teamCount === HumansVsNations) {
      return null;
    }

    if (typeof teamCount === "string") {
      const teamKey = `public_lobby.teams_${teamCount}`;
      const maybeTranslated = translateText(teamKey);
      if (maybeTranslated !== teamKey) return maybeTranslated;
    }

    if (teamTotal !== undefined && teamSize !== undefined) {
      return translateText("public_lobby.players_per_team", { num: teamSize });
    }

    return null;
  }

  private lobbyClicked(lobby: GameInfo) {
    if (this.isButtonDebounced) return;

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
