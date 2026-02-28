import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { PastelTheme } from "../../core/configuration/PastelTheme";
import {
  ColoredTeams,
  Duos,
  GameMode,
  HumansVsNations,
  PlayerInfo,
  PlayerType,
  Quads,
  Team,
  Trios,
} from "../../core/game/Game";
import { getCompactMapNationCount } from "../../core/game/NationCreation";
import { assignTeamsLobbyPreview } from "../../core/game/TeamAssignment";
import { UserSettings } from "../../core/game/UserSettings";
import { ClientInfo, TeamCountConfig } from "../../core/Schemas";
import { createRandomName } from "../../core/Util";
import { getTranslatedPlayerTeamLabel, translateText } from "../Utils";

export interface TeamPreviewData {
  team: Team;
  players: ClientInfo[];
}

@customElement("lobby-player-view")
export class LobbyTeamView extends LitElement {
  @property({ type: String }) gameMode: GameMode = GameMode.FFA;
  @property({ type: Array }) clients: ClientInfo[] = [];
  @state() private teamPreview: TeamPreviewData[] = [];
  @state() private teamMaxSize: number = 0;
  @property({ type: String }) lobbyCreatorClientID: string = "";
  @property({ type: String }) currentClientID: string = "";
  @property({ attribute: "team-count" }) teamCount: TeamCountConfig = 2;
  @property({ type: Function }) onKickPlayer?: (clientID: string) => void;
  @property({ type: Number }) nationCount: number = 0;
  @property({ type: Boolean }) disableNations: boolean = false;
  @property({ type: Boolean }) isCompactMap: boolean = false;

  private theme: PastelTheme = new PastelTheme();
  @state() private showTeamColors: boolean = false;
  private userSettings: UserSettings = new UserSettings();

  willUpdate(changedProperties: Map<string, any>) {
    // Recompute team preview when relevant properties change
    // clients is updated from WebSocket lobby_info events
    if (
      changedProperties.has("gameMode") ||
      changedProperties.has("clients") ||
      changedProperties.has("teamCount") ||
      changedProperties.has("nationCount") ||
      changedProperties.has("disableNations") ||
      changedProperties.has("isCompactMap")
    ) {
      const teamsList = this.getTeamList();
      this.computeTeamPreview(teamsList);
      this.showTeamColors = teamsList.length <= 7;
    }
  }

  render() {
    return html`
      <div class="border-t border-white/10 pt-6">
        <div class="flex justify-between items-center mb-4">
          <div
            class="text-xs font-bold text-white/40 uppercase tracking-widest"
          >
            ${this.clients.length}
            ${this.clients.length === 1
              ? translateText("host_modal.player")
              : translateText("host_modal.players")}
            <span style="margin: 0 8px;">•</span>
            ${this.getEffectiveNationCount()}
            ${this.getEffectiveNationCount() === 1
              ? translateText("host_modal.nation_player")
              : translateText("host_modal.nation_players")}
          </div>
        </div>
        <div
          class="players-list block rounded-lg border border-white/10 bg-white/5 p-2"
        >
          ${this.gameMode === GameMode.Team
            ? this.renderTeamMode()
            : this.renderFreeForAll()}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }

  private renderTeamMode() {
    const active = this.teamPreview.filter(
      (t) => t.players.length > 0 || t.team === ColoredTeams.Nations,
    );
    const empty = this.teamPreview.filter(
      (t) => t.players.length === 0 && t.team !== ColoredTeams.Nations,
    );
    return html` <div
      class="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch"
    >
      <div
        class="w-full md:w-60 bg-gray-800 p-2 border border-gray-700 rounded-lg"
      >
        <div class="font-bold mb-1.5 text-gray-300 text-sm">
          ${translateText("host_modal.players")}
        </div>
        ${repeat(
          this.clients,
          (c) => c.clientID ?? c.username,
          (client) => {
            const displayName = this.displayUsername(client);
            return html`<div
              class="px-2 py-1 rounded-sm bg-gray-700/70 mb-1 text-xs text-white"
            >
              ${displayName}
            </div>`;
          },
        )}
      </div>
      <div class="flex-1 flex flex-col gap-3 md:gap-4 md:pr-1">
        <div>
          <div class="font-semibold text-gray-200 mb-1 text-sm">
            ${translateText("host_modal.assigned_teams")}
          </div>
          <div class="w-full grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
            ${repeat(
              active,
              (p) => p.team,
              (preview) => this.renderTeamCard(preview, false),
            )}
          </div>
        </div>
        <div>
          ${empty.length > 0
            ? html`<div class="font-semibold text-gray-200 mb-1 text-sm">
                ${translateText("host_modal.empty_teams")}
              </div>`
            : ""}
          <div class="w-full grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
            ${repeat(
              empty,
              (p) => p.team,
              (preview) => this.renderTeamCard(preview, true),
            )}
          </div>
        </div>
      </div>
    </div>`;
  }

  private renderFreeForAll() {
    return html`${repeat(
      this.clients,
      (c) => c.clientID ?? c.username,
      (client) => {
        const displayName = this.displayUsername(client);
        return html`<span class="player-tag">
          <span class="text-white">${displayName}</span>
          ${client.clientID === this.lobbyCreatorClientID
            ? html`<span class="host-badge"
                >(${translateText("host_modal.host_badge")})</span
              >`
            : this.onKickPlayer
              ? html`<button
                  class="remove-player-btn"
                  @click=${() => this.onKickPlayer?.(client.clientID)}
                  aria-label=${translateText("host_modal.remove_player", {
                    username: displayName,
                  })}
                >
                  ×
                </button>`
              : html``}
        </span>`;
      },
    )} `;
  }

  private renderTeamCard(preview: TeamPreviewData, isEmpty: boolean = false) {
    const effectiveNationCount = this.getEffectiveNationCount();
    const displayCount =
      preview.team === ColoredTeams.Nations
        ? effectiveNationCount
        : preview.players.length;

    const maxTeamSize =
      preview.team === ColoredTeams.Nations
        ? effectiveNationCount
        : this.teamMaxSize;

    const teamLabel = getTranslatedPlayerTeamLabel(preview.team);

    return html`
      <div class="bg-gray-800 border border-gray-700 rounded-xl flex flex-col">
        <div
          class="px-2 py-1 font-bold flex items-center justify-between text-white rounded-t-xl text-[13px] gap-2 bg-gray-700/70"
        >
          ${this.showTeamColors
            ? html` <span
                class="inline-block w-2.5 h-2.5 rounded-full border-2 border-white/90 shadow-inner bg-(--bg)"
                style="--bg:${this.teamHeaderColor(preview.team)};"
              ></span>`
            : null}
          <span class="truncate">${teamLabel}</span>
          <span class="text-white/90">${displayCount}/${maxTeamSize}</span>
        </div>
        <div class="p-2 ${isEmpty ? "" : "flex flex-col gap-1.5"}">
          ${isEmpty
            ? html`<div class="text-[11px] italic text-gray-400">
                ${translateText("host_modal.empty_team")}
              </div>`
            : repeat(
                preview.players,
                (p) => p.clientID ?? p.username,
                (p) => {
                  const displayName = this.displayUsername(p);
                  return html` <div
                    class="bg-gray-700/70 px-2 py-1 rounded-sm text-xs flex items-center justify-between"
                  >
                    <span class="truncate text-white">${displayName}</span>
                    ${p.clientID === this.lobbyCreatorClientID
                      ? html`<span class="ml-2 text-[11px] text-green-300"
                          >(${translateText("host_modal.host_badge")})</span
                        >`
                      : this.onKickPlayer
                        ? html`<button
                            class="remove-player-btn ml-2"
                            @click=${() => this.onKickPlayer?.(p.clientID)}
                            aria-label=${translateText(
                              "host_modal.remove_player",
                              {
                                username: displayName,
                              },
                            )}
                          >
                            ×
                          </button>`
                        : html``}
                  </div>`;
                },
              )}
        </div>
      </div>
    `;
  }

  private getTeamList(): Team[] {
    if (this.gameMode !== GameMode.Team) return [];
    const playerCount = this.clients.length + this.getEffectiveNationCount();
    const config = this.teamCount;

    if (config === HumansVsNations) {
      return [ColoredTeams.Humans, ColoredTeams.Nations];
    }

    let numTeams: number;
    if (typeof config === "number") {
      numTeams = Math.max(2, config);
    } else {
      const divisor =
        config === Duos ? 2 : config === Trios ? 3 : config === Quads ? 4 : 2;
      numTeams = Math.max(2, Math.ceil(playerCount / divisor));
    }

    if (numTeams < 8) {
      const ordered: Team[] = [
        ColoredTeams.Red,
        ColoredTeams.Blue,
        ColoredTeams.Yellow,
        ColoredTeams.Green,
        ColoredTeams.Purple,
        ColoredTeams.Orange,
        ColoredTeams.Teal,
      ];
      return ordered.slice(0, numTeams);
    }

    return Array.from({ length: numTeams }, (_, i) => `Team ${i + 1}`);
  }

  private teamHeaderColor(team: Team): string {
    try {
      return this.theme.teamColor(team).toHex();
    } catch {
      return "#3b3f46"; // Default gray for unknown teams
    }
  }

  private computeTeamPreview(teams: Team[] = []) {
    if (this.gameMode !== GameMode.Team) {
      this.teamPreview = [];
      this.teamMaxSize = 0;
      return;
    }

    // HumansVsNations: show all clients under Humans initially
    if (this.teamCount === HumansVsNations) {
      this.teamMaxSize = this.clients.length;
      this.teamPreview = [
        { team: ColoredTeams.Humans, players: [...this.clients] },
        { team: ColoredTeams.Nations, players: [] },
      ];
      return;
    }

    const players = this.clients.map(
      (c) =>
        new PlayerInfo(c.username, PlayerType.Human, c.clientID, c.clientID),
    );
    const assignment = assignTeamsLobbyPreview(
      players,
      teams,
      this.getEffectiveNationCount(),
    );
    const buckets = new Map<Team, ClientInfo[]>();
    for (const t of teams) buckets.set(t, []);

    for (const [p, team] of assignment.entries()) {
      if (team === "kicked") continue;
      const bucket = buckets.get(team);
      if (!bucket) continue;
      const client = this.clients.find((c) => c.clientID === p.clientID);
      if (client) bucket.push(client);
    }

    // Compute per-team capacity safely and align with common team sizes
    if (this.teamCount === Duos) {
      this.teamMaxSize = 2;
    } else if (this.teamCount === Trios) {
      this.teamMaxSize = 3;
    } else if (this.teamCount === Quads) {
      this.teamMaxSize = 4;
    } else {
      // Fallback: divide players across teams; guard against 0 and empty lobbies
      this.teamMaxSize = Math.max(
        1,
        Math.ceil(
          (this.clients.length + this.getEffectiveNationCount()) / teams.length,
        ),
      );
    }
    this.teamPreview = teams.map((t) => ({
      team: t,
      players: buckets.get(t) ?? [],
    }));
  }

  /**
   * Returns the effective nation count for display purposes.
   * In HumansVsNations mode, this equals the number of human players.
   * For compact maps, only 25% of nations are used.
   * Otherwise, it uses the manifest nation count (or 0 if nations are disabled).
   */
  private getEffectiveNationCount(): number {
    if (this.disableNations) {
      return 0;
    }
    if (this.gameMode === GameMode.Team && this.teamCount === HumansVsNations) {
      return this.clients.length;
    }
    return getCompactMapNationCount(this.nationCount, this.isCompactMap);
  }

  private displayUsername(client: ClientInfo): string {
    if (!this.userSettings.anonymousNames()) {
      return client.username;
    }

    if (this.currentClientID && client.clientID === this.currentClientID) {
      return client.username;
    }

    return (
      createRandomName(client.username, PlayerType.Human) ?? client.username
    );
  }
}
