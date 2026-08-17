import { html, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMapType } from "../../core/game/Game";
import { PublicGameInfo, PublicGames } from "../../core/Schemas";
import { JoinLobbyModal } from "../JoinLobbyModal";
import { PublicLobbySocket } from "../LobbySocket";
import { JoinLobbyEvent } from "../Main";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import { UsernameInput } from "../UsernameInput";
import {
  calculateServerTimeOffset,
  getGameModeLabel,
  getMapName,
  getModifierLabels,
  getSecondsUntilServerTimestamp,
  renderDuration,
  translateText,
} from "../Utils";
import { BaseModal } from "./BaseModal";
import {
  DEFAULT_FILTERS,
  deleteFilterProfile,
  filterAndSortLobbies,
  flattenLobbies,
  loadFilterProfiles,
  LOBBY_MODES,
  LOBBY_SOURCES,
  lobbyFacts,
  LobbyFilters,
  LobbyModeFilter,
  LobbySourceFilter,
  NAMED_TEAM_CONFIGS,
  NUMERIC_TEAM_CONFIGS,
  saveFilterProfile,
  SORT_KEYS,
  SortKey,
} from "./MoreGamesFilters";
import { modalHeader } from "./ui/ModalHeader";

type BoundKey =
  | "minJoined"
  | "maxJoined"
  | "minCapacity"
  | "maxCapacity"
  | "minTeamSize"
  | "maxTeamSize";

const CHIP_BASE =
  "px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider " +
  "border transition-colors";
const CHIP_ON = "bg-malibu-blue text-white border-malibu-blue";
const CHIP_OFF =
  "bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white";
const NUMBER_INPUT_CLASS =
  "w-16 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white " +
  "text-xs text-center focus:outline-none focus:border-malibu-blue";
const SELECT_CLASS =
  "px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white text-xs " +
  "focus:outline-none focus:border-malibu-blue";

/**
 * The full lobby browser behind the homepage "More Games" button: every lobby
 * the server advertises (not just the one card per bucket the homepage shows),
 * with filtering, sorting and saved filter profiles.
 */
@customElement("more-games-modal")
export class MoreGamesModal extends BaseModal {
  protected routerName = "more-games";

  @state() private lobbies: PublicGames | null = null;
  @state() private filters: LobbyFilters = { ...DEFAULT_FILTERS };
  @state() private showFilters = false;
  @state() private profiles: Record<string, LobbyFilters> = {};
  @state() private selectedProfile = "";
  @state() private profileName = "";

  private serverTimeOffset = 0;
  private countdownTimer: number | null = null;

  private lobbySocket = new PublicLobbySocket((lobbies) => {
    this.lobbies = lobbies;
    this.serverTimeOffset = calculateServerTimeOffset(lobbies.serverTime);
  });

  constructor() {
    super();
    this.id = "page-more-games";
  }

  protected override onOpen(): void {
    this.profiles = loadFilterProfiles();
    void this.lobbySocket.start();
    // Countdowns are derived from server timestamps, so a plain repaint keeps
    // them ticking between socket updates.
    this.countdownTimer ??= window.setInterval(
      () => this.requestUpdate(),
      1000,
    );
  }

  protected override onClose(): void {
    this.lobbySocket.stop();
    this.lobbies = null;
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  disconnectedCallback() {
    this.onClose();
    super.disconnectedCallback();
  }

  createRenderRoot() {
    return this;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("more_games.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody(): TemplateResult {
    if (this.lobbies === null) {
      return this.renderLoadingSpinner();
    }

    const all = flattenLobbies(this.lobbies.games);
    const shown = filterAndSortLobbies(all, this.filters, (lobby) =>
      this.mapNameOf(lobby),
    );

    return html`
      <div class="custom-scrollbar p-4 lg:p-6 flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="text-xs text-white/60 uppercase tracking-wider">
            ${translateText("more_games.showing", {
              shown: String(shown.length),
              total: String(all.length),
            })}
          </span>
          <div class="flex items-center gap-2">
            ${this.renderSortSelect()}
            <button
              @click=${() => (this.showFilters = !this.showFilters)}
              class="px-3 py-1 rounded-md bg-white/5 border border-white/10 text-white text-xs font-bold uppercase tracking-wider hover:bg-white/10 transition-colors"
              aria-expanded=${this.showFilters ? "true" : "false"}
            >
              ${translateText("more_games.filters")}
            </button>
          </div>
        </div>

        ${this.showFilters ? this.renderFilterPanel() : nothing}
        ${shown.length === 0
          ? html`<p class="py-10 text-center text-sm text-white/50">
              ${translateText("more_games.no_lobbies")}
            </p>`
          : html`<div class="flex flex-col gap-2">
              ${this.renderColumnHeader()}
              ${shown.map((lobby) => this.renderLobbyRow(lobby))}
            </div>`}
      </div>
    `;
  }

  // ---- Filter panel ----

  private renderSortSelect() {
    return html`
      <select
        class="${SELECT_CLASS}"
        aria-label=${translateText("more_games.sort")}
        .value=${this.filters.sort}
        @change=${(e: Event) =>
          this.patchFilters({
            sort: (e.target as HTMLSelectElement).value as SortKey,
          })}
      >
        ${SORT_KEYS.map(
          (key) =>
            html`<option value=${key} ?selected=${this.filters.sort === key}>
              ${translateText(`more_games.sort_${key}`)}
            </option>`,
        )}
      </select>
    `;
  }

  private renderFilterPanel() {
    return html`
      <div
        class="flex flex-col gap-3 p-3 rounded-xl bg-white/5 border border-white/10"
      >
        ${this.renderChipGroup(
          translateText("more_games.mode"),
          LOBBY_MODES.map((mode) => ({
            value: mode,
            label: translateText(`more_games.mode_${mode}`),
            active: this.filters.modes.includes(mode),
          })),
          (value) =>
            this.patchFilters({
              modes: toggle(this.filters.modes, value as LobbyModeFilter),
            }),
        )}
        ${this.renderChipGroup(
          translateText("more_games.source"),
          LOBBY_SOURCES.map((source) => ({
            value: source,
            label: translateText(`more_games.source_${source}`),
            active: this.filters.sources.includes(source),
          })),
          (value) =>
            this.patchFilters({
              sources: toggle(this.filters.sources, value as LobbySourceFilter),
            }),
        )}
        ${this.renderChipGroup(
          translateText("more_games.team_config"),
          [
            // Named formats reuse the host modal's labels ("Duos (teams of
            // 2)"); numeric ones are plain team counts.
            ...NAMED_TEAM_CONFIGS.map((name) => ({
              value: name as string,
              label: translateText(`host_modal.teams_${name}`),
              active: this.filters.teamConfigs.includes(name),
            })),
            ...NUMERIC_TEAM_CONFIGS.map((count) => ({
              value: count,
              label: translateText("public_lobby.teams", { num: count }),
              active: this.filters.teamConfigs.includes(count),
            })),
          ],
          (value) =>
            this.patchFilters({
              teamConfigs: toggle(this.filters.teamConfigs, value),
            }),
        )}

        <div class="flex flex-wrap gap-x-6 gap-y-2">
          ${this.renderRange(
            translateText("more_games.joined_players"),
            "minJoined",
            "maxJoined",
          )}
          ${this.renderRange(
            translateText("more_games.capacity"),
            "minCapacity",
            "maxCapacity",
          )}
          ${this.renderRange(
            translateText("more_games.team_size"),
            "minTeamSize",
            "maxTeamSize",
          )}
        </div>

        <label class="flex items-center gap-2 text-xs text-white/70">
          <input
            type="checkbox"
            class="accent-malibu-blue"
            .checked=${this.filters.hideEmpty}
            @change=${(e: Event) =>
              this.patchFilters({
                hideEmpty: (e.target as HTMLInputElement).checked,
              })}
          />
          ${translateText("more_games.hide_empty")}
        </label>

        ${this.renderProfiles()}
      </div>
    `;
  }

  private renderChipGroup(
    label: string,
    options: { value: string; label: string; active: boolean }[],
    onToggle: (value: string) => void,
  ) {
    return html`
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="text-xs text-white/50 uppercase tracking-wider w-full sm:w-28 shrink-0"
          >${label}</span
        >
        ${options.map(
          (option) =>
            html`<button
              @click=${() => onToggle(option.value)}
              aria-pressed=${option.active ? "true" : "false"}
              class="${CHIP_BASE} ${option.active ? CHIP_ON : CHIP_OFF}"
            >
              ${option.label}
            </button>`,
        )}
      </div>
    `;
  }

  private renderRange(label: string, minKey: BoundKey, maxKey: BoundKey) {
    return html`
      <div class="flex items-center gap-2">
        <span class="text-xs text-white/50 uppercase tracking-wider"
          >${label}</span
        >
        <input
          type="number"
          min="0"
          class="${NUMBER_INPUT_CLASS}"
          aria-label="${label} ${translateText("more_games.min")}"
          placeholder=${translateText("more_games.min")}
          .value=${boundValue(this.filters[minKey])}
          @change=${(e: Event) => this.setBound(minKey, e)}
        />
        <span class="text-xs text-white/30">–</span>
        <input
          type="number"
          min="0"
          class="${NUMBER_INPUT_CLASS}"
          aria-label="${label} ${translateText("more_games.max")}"
          placeholder=${translateText("more_games.max")}
          .value=${boundValue(this.filters[maxKey])}
          @change=${(e: Event) => this.setBound(maxKey, e)}
        />
      </div>
    `;
  }

  private renderProfiles() {
    const names = Object.keys(this.profiles).sort((a, b) => a.localeCompare(b));
    return html`
      <div
        class="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10"
      >
        <span
          class="text-xs text-white/50 uppercase tracking-wider w-full sm:w-28 shrink-0"
          >${translateText("more_games.profiles")}</span
        >
        <select
          class="${SELECT_CLASS}"
          aria-label=${translateText("more_games.profiles")}
          @change=${(e: Event) =>
            this.applyProfile((e.target as HTMLSelectElement).value)}
        >
          <option value="" ?selected=${this.selectedProfile === ""}>
            ${translateText("more_games.no_profile")}
          </option>
          ${names.map(
            (name) =>
              html`<option
                value=${name}
                ?selected=${this.selectedProfile === name}
              >
                ${name}
              </option>`,
          )}
        </select>
        <input
          type="text"
          maxlength="32"
          class="w-32 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:border-malibu-blue"
          placeholder=${translateText("more_games.profile_name")}
          aria-label=${translateText("more_games.profile_name")}
          .value=${this.profileName}
          @input=${(e: Event) =>
            (this.profileName = (e.target as HTMLInputElement).value)}
        />
        <button
          @click=${() => this.saveProfile()}
          class="${CHIP_BASE} ${CHIP_OFF}"
        >
          ${translateText("more_games.save_profile")}
        </button>
        <button
          @click=${() => this.deleteProfile()}
          ?disabled=${this.selectedProfile === ""}
          class="${CHIP_BASE} ${CHIP_OFF} ${this.selectedProfile === ""
            ? "opacity-40 cursor-not-allowed"
            : ""}"
        >
          ${translateText("more_games.delete_profile")}
        </button>
        <button
          @click=${() => this.resetFilters()}
          class="${CHIP_BASE} ${CHIP_OFF}"
        >
          ${translateText("more_games.reset")}
        </button>
      </div>
    `;
  }

  // ---- Lobby rows ----

  private renderColumnHeader() {
    return html`
      <div
        class="hidden sm:grid grid-cols-[minmax(0,1fr)_7rem_5rem_6rem_5rem] gap-2 px-3 text-[10px] text-white/40 uppercase tracking-widest"
      >
        <span>${translateText("more_games.column_map")}</span>
        <span>${translateText("more_games.column_mode")}</span>
        <span class="text-center"
          >${translateText("more_games.column_players")}</span
        >
        <span class="text-center"
          >${translateText("more_games.column_starts")}</span
        >
        <span></span>
      </div>
    `;
  }

  private renderLobbyRow(lobby: PublicGameInfo) {
    const config = lobby.gameConfig;
    const mapName = this.mapNameOf(lobby);
    const mapType = config?.gameMap as GameMapType | undefined;
    const thumbnail = mapType
      ? terrainMapFileLoader.getMapData(mapType).webpPath
      : undefined;
    const facts = lobbyFacts(lobby);
    const modifiers = getModifierLabels(
      config?.publicGameModifiers,
      config?.doomsdayClock?.speed,
    );
    const modeLabel = config ? getGameModeLabel(config) : "";
    const title = lobby.featured && lobby.label ? lobby.label : mapName;

    return html`
      <div
        class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_6rem_5rem] items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
      >
        <div class="flex items-center gap-3 min-w-0">
          ${thumbnail
            ? html`<img
                src=${thumbnail}
                alt=${mapName}
                draggable="false"
                class="w-12 h-9 rounded-md object-cover border border-white/10 shrink-0"
                @error=${(e: Event) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />`
            : nothing}
          <div class="flex flex-col min-w-0">
            <span class="text-sm font-bold text-white truncate">${title}</span>
            ${modifiers.length > 0
              ? html`<div class="flex flex-wrap gap-1 mt-0.5">
                  ${modifiers.map(
                    (label) =>
                      html`<span
                        class="px-1.5 py-0.5 rounded bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-wider"
                        >${label}</span
                      >`,
                  )}
                </div>`
              : nothing}
          </div>
        </div>

        <span class="text-xs text-white/70 sm:truncate">
          <span class="sm:hidden text-white/40"
            >${translateText("more_games.column_mode")}:
          </span>
          ${modeLabel}
        </span>

        <span class="text-xs font-bold text-white sm:text-center">
          <span class="sm:hidden text-white/40 font-normal"
            >${translateText("more_games.column_players")}:
          </span>
          ${facts.joined}${facts.capacity === null ? "" : `/${facts.capacity}`}
        </span>

        <span class="text-xs text-white/70 sm:text-center">
          <span class="sm:hidden text-white/40"
            >${translateText("more_games.column_starts")}:
          </span>
          ${this.startsLabel(lobby)}
        </span>

        <button
          @click=${() => this.join(lobby)}
          class="px-3 py-1.5 rounded-lg bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 text-white text-xs font-bold uppercase tracking-wider transition-colors"
        >
          ${translateText("more_games.join")}
        </button>
      </div>
    `;
  }

  private startsLabel(lobby: PublicGameInfo): string {
    if (lobby.startsAt === undefined) {
      // Scheduled lobbies only get a countdown once they're the active one for
      // their bucket; the one queued behind it is simply next up. Hosted
      // lobbies never get one — they start when the host says so.
      return lobby.publicGameType === "hosted"
        ? translateText("public_lobby.waiting_for_players")
        : translateText("more_games.queued");
    }
    const seconds = getSecondsUntilServerTimestamp(
      lobby.startsAt,
      this.serverTimeOffset,
    );
    return seconds > 0
      ? renderDuration(seconds)
      : translateText("public_lobby.starting_game");
  }

  private mapNameOf(lobby: PublicGameInfo): string {
    return getMapName(lobby.gameConfig?.gameMap) ?? "";
  }

  // ---- Actions ----

  private patchFilters(patch: Partial<LobbyFilters>) {
    this.filters = { ...this.filters, ...patch };
  }

  private setBound(key: BoundKey, event: Event) {
    const raw = (event.target as HTMLInputElement).value.trim();
    if (raw === "") {
      this.patchFilters({ [key]: null } as Partial<LobbyFilters>);
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    this.patchFilters({
      [key]: Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
    } as Partial<LobbyFilters>);
  }

  private resetFilters() {
    this.filters = { ...DEFAULT_FILTERS };
    this.selectedProfile = "";
  }

  private applyProfile(name: string) {
    this.selectedProfile = name;
    if (name === "") return;
    const profile = this.profiles[name];
    if (profile) {
      this.filters = { ...profile };
      this.profileName = name;
    }
  }

  private saveProfile() {
    const name = this.profileName.trim();
    if (name === "") return;
    this.profiles = saveFilterProfile(name, this.filters);
    this.selectedProfile = name in this.profiles ? name : this.selectedProfile;
  }

  private deleteProfile() {
    if (this.selectedProfile === "") return;
    this.profiles = deleteFilterProfile(this.selectedProfile);
    this.selectedProfile = "";
  }

  // Silent backstop, mirroring the homepage buttons: an invalid username can't
  // start a game, and the input itself surfaces the reason.
  private canPlay(): boolean {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    return usernameInput ? usernameInput.canPlay() : true;
  }

  private join(lobby: PublicGameInfo) {
    if (!this.canPlay()) return;
    this.close();

    // Hosted lobbies are private games a subscriber listed publicly: joining
    // one goes through the join modal's tracking flow, not the public path.
    if (lobby.publicGameType === "hosted") {
      (
        document.querySelector("join-lobby-modal") as JoinLobbyModal | null
      )?.open({ lobbyId: lobby.gameID });
      return;
    }

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobby.gameID,
          source: "public",
          publicLobbyInfo: lobby,
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

function toggle<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

function boundValue(value: number | null): string {
  return value === null ? "" : String(value);
}
