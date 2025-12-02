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
import { assignTeamsLobbyPreview } from "../../core/game/TeamAssignment";
import { ClientInfo, TeamCountConfig } from "../../core/Schemas";
import { translateText } from "../Utils";

export interface TeamPreviewData {
  team: Team;
  players: ClientInfo[];
}

@customElement("lobby-team-view")
export class LobbyTeamView extends LitElement {
  @property({ type: String }) gameMode: GameMode = GameMode.FFA;
  @property({ type: Array }) clients: ClientInfo[] = [];
  @state() private teamPreview: TeamPreviewData[] = [];
  @state() private teamMaxSize: number = 0;
  @property({ type: String }) lobbyCreatorClientID: string = "";
  @property({ attribute: "team-count" }) teamCount: TeamCountConfig = 2;
  @property({ type: Function }) onKickPlayer?: (clientID: string) => void;
  @property({ type: Number }) nationCount: number = 0;

  private theme: PastelTheme = new PastelTheme();
  @state() private showTeamColors: boolean = false;

  willUpdate(changedProperties: Map<string, any>) {
    // Recompute team preview when relevant properties change
    // clients is 'changed' every 1s from pollPlayers, chose to not compare for actual change
    if (
      changedProperties.has("gameMode") ||
      changedProperties.has("clients") ||
      changedProperties.has("teamCount") ||
      changedProperties.has("nationCount")
    ) {
      const teamsList = this.getTeamList();
      this.computeTeamPreview(teamsList);
      this.showTeamColors = teamsList.length <= 7;
    }
  }

  render() {
    return html`<div class="players-list">
      ${this.gameMode === GameMode.Team
        ? this.renderTeamMode()
        : this.renderFreeForAll()}
    </div>`;
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
      class="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch max-h-[65vh]"
    >
      <div
        class="w-full md:w-60 bg-gray-800 p-2 border border-gray-700 rounded-lg max-h-40 md:max-h-[65vh] overflow-auto"
      >
        <div class="font-bold mb-1.5 text-gray-300 text-sm">
          ${translateText("host_modal.players")}
        </div>
        ${repeat(
          this.clients,
          (c) => c.clientID ?? c.username,
          (client) =>
            html`<div class="px-2 py-1 rounded bg-gray-700/70 mb-1 text-xs">
              ${client.username}
            </div>`,
        )}
      </div>
      <div
        class="flex-1 flex flex-col gap-3 md:gap-4 overflow-auto max-h-[65vh] md:pr-1"
      >
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
      (client) =>
        html`<span class="player-tag">
          ${client.username}
          ${client.clientID === this.lobbyCreatorClientID
            ? html`<span class="host-badge"
                >(${translateText("host_modal.host_badge")})</span
              >`
            : html`<button
                class="remove-player-btn"
                @click=${() => this.onKickPlayer?.(client.clientID)}
                aria-label=${translateText("host_modal.remove_player", {
                  username: client.username,
                })}
              >
                ×
              </button>`}
        </span>`,
    )} `;
  }

  private renderTeamCard(preview: TeamPreviewData, isEmpty: boolean = false) {
    const displayCount =
      preview.team === ColoredTeams.Nations
        ? this.nationCount
        : preview.players.length;

    const maxTeamSize =
      preview.team === ColoredTeams.Nations
        ? this.nationCount
        : this.teamMaxSize;

    return html`
      <div class="bg-gray-800 border border-gray-700 rounded-xl flex flex-col">
        <div
          class="px-2 py-1 font-bold flex items-center justify-between text-white rounded-t-xl text-[13px] gap-2 bg-gray-700/70"
        >
          ${this.showTeamColors
            ? html`<span
                class="inline-block w-2.5 h-2.5 rounded-full border-2 border-white/90 shadow-inner"
                style="background:${this.teamHeaderColor(preview.team)};"
              ></span>`
            : null}
          <span class="truncate">${preview.team}</span>
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
                (p) =>
                  html` <div
                    class="bg-gray-700/70 px-2 py-1 rounded text-xs flex items-center justify-between"
                  >
                    <span class="truncate">${p.username}</span>
                    ${p.clientID === this.lobbyCreatorClientID
                      ? html`<span class="ml-2 text-[11px] text-green-300"
                          >(${translateText("host_modal.host_badge")})</span
                        >`
                      : html`<button
                          class="remove-player-btn ml-2"
                          @click=${() => this.onKickPlayer?.(p.clientID)}
                          aria-label=${translateText(
                            "host_modal.remove_player",
                            {
                              username: p.username,
                            },
                          )}
                        >
                          ×
                        </button>`}
                  </div>`,
              )}
        </div>
      </div>
    `;
  }

  private getTeamList(): Team[] {
    if (this.gameMode !== GameMode.Team) return [];
    const playerCount = this.clients.length + this.nationCount;
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
      this.nationCount,
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
        Math.ceil((this.clients.length + this.nationCount) / teams.length),
      );
    }
    this.teamPreview = teams.map((t) => ({
      team: t,
      players: buckets.get(t) ?? [],
    }));
  }
}
