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
import { getClientIDForGame } from "./Auth";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

@customElement("public-lobby")
export class PublicLobby extends LitElement {
  @state() private lobbies: GameInfo[] = [];
  @state() private mapImages: Map<GameID, string> = new Map();

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
  }

  private handleLobbiesUpdate(lobbies: GameInfo[]) {
    this.lobbies = lobbies;
    document.dispatchEvent(
      new CustomEvent("public-lobbies-update", {
        detail: { lobbies },
      }),
    );
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
    const mapName = translateText(
      `map.${lobby.gameConfig.gameMap.toLowerCase().replace(/[\s.]+/g, "")}`,
    );

    return html`
      <button
        @click=${() => this.lobbyClicked(lobby)}
        class="group relative isolate flex flex-col w-full h-80 lg:h-96 overflow-hidden rounded-2xl transition-transform duration-200 bg-[color-mix(in_oklab,var(--frenchBlue)_80%,black)] hover:scale-[1.01] active:scale-[0.98]"
      >
        <div
          class="relative flex-1 w-full overflow-hidden bg-[color-mix(in_oklab,var(--frenchBlue)_80%,black)] text-white"
        >
          ${mapImageSrc
            ? html`<img
                src="${mapImageSrc}"
                alt="${lobby.gameConfig.gameMap}"
                draggable="false"
                @dragstart=${(e: DragEvent) => e.preventDefault()}
                class="absolute inset-0 w-full h-full object-contain object-center select-none pointer-events-none"
              />`
            : null}

          <div
            class="absolute inset-x-3 top-3 flex justify-between items-start gap-2 pointer-events-none"
          >
            ${fullModeLabel
              ? html`<span
                  class="px-3 py-1 rounded font-bold text-xs lg:text-sm uppercase tracking-widest bg-slate-800 text-white ring-1 ring-white/10 shadow-sm"
                >
                  ${fullModeLabel}
                </span>`
              : html`<span></span>`}

            <span
              class="px-3 py-1 rounded font-bold text-[10px] uppercase tracking-widest bg-blue-700 text-white"
            >
              ${timeRemaining > 0
                ? timeDisplay
                : translateText("public_lobby.started")}
            </span>
          </div>

          ${modifierLabel.length > 0
            ? html`<div
                class="absolute left-3 right-28 bottom-3 flex flex-row flex-wrap gap-1 pointer-events-none"
              >
                ${modifierLabel.map(
                  (label) =>
                    html`<span
                      class="px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-teal-600 text-white shadow-[0_0_6px_rgba(13,148,136,0.35)]"
                      >${label}</span
                    >`,
                )}
              </div>`
            : null}
        </div>

        <div
          class="flex items-center justify-between px-4 py-3 bg-[color-mix(in_oklab,var(--frenchBlue)_90%,black)] text-white"
        >
          <div class="flex flex-col gap-1 min-w-0">
            <h3
              class="text-sm lg:text-base font-bold uppercase tracking-wider text-left leading-tight"
            >
              ${modeLabel}
            </h3>
            <p class="text-[11px] text-white/70 uppercase tracking-wider">
              ${mapName}
            </p>
          </div>
          <span class="text-xs font-bold uppercase tracking-widest shrink-0">
            ${lobby.numClients}/${lobby.gameConfig.maxPlayers}
          </span>
        </div>
      </button>
    `;
  }

  leaveLobby() {}

  public stop() {
    this.lobbySocket.stop();
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

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobby.gameID,
          clientID: getClientIDForGame(lobby.gameID),
          source: "public",
          publicLobbyInfo: lobby,
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }
}
