import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { PastelTheme } from "../core/configuration/PastelTheme";
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
} from "../core/game/Game";
import { assignTeams } from "../core/game/TeamAssignment";
import { ClientInfo, TeamCountConfig } from "../core/Schemas";
import { translateText } from "./Utils";

export interface TeamPreviewData {
  team: Team;
  players: ClientInfo[];
}

@customElement("lobby-team-view")
export class LobbyTeamView extends LitElement {
  @property({ type: String }) gameMode: GameMode = GameMode.FFA;
  @property({ type: Array }) clients: ClientInfo[] = [];
  @property({ type: Array }) teamPreview: TeamPreviewData[] = [];
  @property({ type: Number }) teamMaxSize: number = 0;
  @property({ type: String }) lobbyCreatorClientID: string = "";
  @property({ attribute: "team-count" }) teamCount: TeamCountConfig = 2;
  @property({ type: Function }) onKickPlayer?: (clientID: string) => void;

  private theme: PastelTheme = new PastelTheme();
  private showTeamColors: boolean = false;

  willUpdate(changedProperties: Map<string, any>) {
    // Recompute team preview when relevant properties change
    if (
      changedProperties.has("gameMode") ||
      changedProperties.has("clients") ||
      changedProperties.has("teamCount")
    ) {
      this.computeTeamPreview();
      this.showTeamColors = this.getTeamList().length <= 7;
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
    const active = this.teamPreview.filter((t) => t.players.length > 0);
    const empty = this.teamPreview.filter((t) => t.players.length === 0);
    return html` <div class="flex gap-4 items-stretch max-h-[65vh]">
      <div
        class="w-60 bg-gray-800 p-2 border border-gray-700 rounded-lg max-h-[65vh] overflow-auto"
      >
        <div class="font-bold mb-1.5 text-gray-300">
          ${translateText("host_modal.players")}
        </div>
        ${this.clients.map(
          (client) =>
            html`<div class="px-2 py-1 rounded bg-gray-700/70 mb-1 text-xs">
              ${client.username}
            </div>`,
        )}
      </div>
      <div class="flex-1 flex flex-col gap-4 overflow-auto max-h-[65vh] pr-1">
        <div>
          <div class="font-semibold text-gray-200 mb-1">
            ${translateText("host_modal.assigned_teams")}
          </div>
          <div class="w-full grid grid-cols-2 gap-3">
            ${active.map((preview) => this.renderTeamCard(preview, false))}
          </div>
        </div>
        <div>
          <div class="font-semibold text-gray-200 mb-1">
            ${translateText("host_modal.empty_teams")}
          </div>
          <div class="w-full grid grid-cols-2 gap-3">
            ${empty.map((preview) => this.renderTeamCard(preview, true))}
          </div>
        </div>
      </div>
    </div>`;
  }

  private renderFreeForAll() {
    return html`${this.clients.map(
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
                title="Remove ${client.username}"
              >
                ×
              </button>`}
        </span>`,
    )} `;
  }

  private renderTeamCard(preview: TeamPreviewData, isEmpty: boolean = false) {
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
          <span class="text-white/90"
            >${preview.players.length}/${this.teamMaxSize}</span
          >
        </div>
        <div class="p-2 ${isEmpty ? "" : "flex flex-col gap-1.5"}">
          ${isEmpty
            ? html`<div class="text-[11px] italic text-gray-400">
                ${translateText("host_modal.empty_team")}
              </div>`
            : preview.players.map(
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
                          title="Remove ${p.username}"
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
    const playerCount = this.clients.length;
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

  private computeTeamPreview() {
    if (this.gameMode !== GameMode.Team) {
      this.teamPreview = [];
      this.teamMaxSize = 0;
      return;
    }
    const teams = this.getTeamList();

    // HumansVsNations: show all clients under Humans initially
    if (this.teamCount === HumansVsNations) {
      this.teamMaxSize = this.clients.length;
      this.teamPreview = [
        { team: ColoredTeams.Humans, players: [...this.clients] },
        { team: ColoredTeams.Nations, players: [] },
      ];
      return;
    }

    const clientMap = new Map(this.clients.map((c) => [c.clientID, c]));
    const players = this.clients.map(
      (c) =>
        new PlayerInfo(c.username, PlayerType.Human, c.clientID, c.clientID),
    );
    const assignment = assignTeams(players, teams);
    const buckets = new Map<Team, ClientInfo[]>();
    teams.forEach((t) => buckets.set(t, []));

    for (const [player, team] of assignment.entries()) {
      if (team === "kicked" || !player.clientID) continue;
      const client = clientMap.get(player.clientID);
      if (client) buckets.get(team)?.push(client);
    }

    // Capacity mapping
    const sizeMap: Record<string, number> = {
      [Duos]: 2,
      [Trios]: 3,
      [Quads]: 4,
    };
    this.teamMaxSize =
      sizeMap[this.teamCount as any] ||
      Math.max(1, Math.ceil(this.clients.length / Math.max(teams.length, 1)));

    this.teamPreview = teams.map((team) => ({
      team,
      players: buckets.get(team) ?? [],
    }));
  }
}
