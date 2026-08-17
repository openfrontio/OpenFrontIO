import { html, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMapType } from "../../core/game/Game";
import { PublicGameInfo, PublicGames } from "../../core/Schemas";
import { JoinLobbyModal } from "../JoinLobbyModal";
import { PublicLobbySocket } from "../LobbySocket";
import { JoinLobbyEvent } from "../Main";
import { UsernameInput } from "../UsernameInput";
import {
  calculateServerTimeOffset,
  getGameModeLabel,
  getMapName,
  getSecondsUntilServerTimestamp,
  renderDuration,
  translateText,
} from "../Utils";
import "./baseComponents/Button";
import { BaseModal } from "./BaseModal";
import {
  DEFAULT_FILTERS,
  deleteFilterProfile,
  filterAndSortLobbies,
  flattenLobbies,
  hasFilterProfile,
  loadFilterProfiles,
  LOBBY_MODES,
  LOBBY_SOURCES,
  LobbyFilters,
  LobbyModeFilter,
  LobbySourceFilter,
  NAMED_TEAM_CONFIGS,
  NUMERIC_TEAM_CONFIGS,
  saveFilterProfile,
} from "./DetailedViewFilters";
import { lobbyCard, mapAspectRatios } from "./LobbyCard";
import { modalHeader } from "./ui/ModalHeader";
import { styledSelect } from "./ui/StyledSelect";

/** The three scheduled buckets, in the order their panes are laid out. */
const SCHEDULED_PANES = ["ffa", "team", "special"] as const;

type BoundKey =
  | "minJoined"
  | "maxJoined"
  | "minCapacity"
  | "maxCapacity"
  | "minTeamSize"
  | "maxTeamSize";

const CHIP_BASE =
  "px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider " +
  "border transition-colors";
const CHIP_ON = "bg-malibu-blue text-white border-malibu-blue";
const CHIP_OFF =
  "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white";
const SECTION_LABEL =
  "block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5";
const FIELD_CLASS =
  "px-2 py-1.5 rounded-lg bg-black/30 border border-white/10 text-white " +
  "text-xs focus:outline-none focus:border-malibu-blue";
const BUTTON_CLASS =
  "px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider " +
  "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 " +
  "hover:text-white transition-colors";

/**
 * The full lobby browser behind the homepage "More Games" button: every lobby
 * the server advertises (not just the one card per bucket the homepage shows),
 * rendered as the same map cards, with filtering, sorting and saved filter
 * profiles.
 */
@customElement("detailed-view-modal")
export class DetailedViewModal extends BaseModal {
  protected routerName = "detailed-view";

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
    for (const lobby of flattenLobbies(lobbies.games)) {
      mapAspectRatios.ensure(lobby.gameConfig?.gameMap as GameMapType, () =>
        this.requestUpdate(),
      );
    }
  });

  constructor() {
    super();
    this.id = "page-detailed-view";
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
    const count = this.activeFilterCount();
    return modalHeader({
      title: translateText("detailed_view.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent: html`<o-button
        variant=${this.showFilters ? "primary" : "secondary"}
        size="sm"
        title=${count > 0
          ? translateText("detailed_view.filters_with_count", { count })
          : translateText("detailed_view.filters")}
        @click=${() => (this.showFilters = !this.showFilters)}
      ></o-button>`,
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
      <div class="custom-scrollbar p-4 lg:p-6 flex flex-col gap-4">
        <span class="text-xs text-white/50 uppercase tracking-wider">
          ${translateText("detailed_view.showing", {
            shown: String(shown.length),
            total: String(all.length),
          })}
        </span>

        ${this.showFilters ? this.renderFilterPanel() : nothing}
        ${shown.length === 0
          ? html`<p class="py-12 text-center text-sm text-white/50">
              ${translateText("detailed_view.no_lobbies")}
            </p>`
          : html`
              <!-- One pane per scheduled bucket, cards stacked within it. -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
                ${SCHEDULED_PANES.map((type) =>
                  this.renderPane(
                    translateText(`detailed_view.pane_${type}`),
                    shown.filter((lobby) => lobby.publicGameType === type),
                  ),
                )}
              </div>
              ${this.renderHostedPane(
                shown.filter((lobby) => lobby.publicGameType === "hosted"),
              )}
            `}
      </div>
    `;
  }

  // ---- Lobby panes ----

  private renderPane(title: string, lobbies: PublicGameInfo[]) {
    return html`
      <section class="flex flex-col gap-2 min-w-0">
        <h3 class="${SECTION_LABEL} mb-0">${title} (${lobbies.length})</h3>
        ${lobbies.length === 0
          ? html`<p
              class="py-6 text-center text-xs text-white/30 rounded-xl border border-dashed border-white/10"
            >
              ${translateText("detailed_view.pane_empty")}
            </p>`
          : lobbies.map((lobby) => this.renderCard(lobby))}
      </section>
    `;
  }

  /**
   * Subscriber-hosted lobbies don't belong to any scheduled bucket, so they get
   * their own row below the three panes — and only when some exist.
   */
  private renderHostedPane(lobbies: PublicGameInfo[]) {
    if (lobbies.length === 0) return nothing;
    return html`
      <section class="flex flex-col gap-2">
        <h3 class="${SECTION_LABEL} mb-0">
          ${translateText("detailed_view.pane_hosted")} (${lobbies.length})
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          ${lobbies.map((lobby) => this.renderCard(lobby))}
        </div>
      </section>
    `;
  }

  // ---- Lobby cards ----

  private renderCard(lobby: PublicGameInfo) {
    const config = lobby.gameConfig;
    if (!config) return nothing;
    return lobbyCard({
      lobby,
      subtitle: getGameModeLabel(config),
      timeDisplay: this.timeDisplay(lobby),
      timeDisplayUppercase: lobby.startsAt === undefined,
      heightClass: "h-40",
      onClick: () => this.join(lobby),
    });
  }

  private timeDisplay(lobby: PublicGameInfo): string {
    if (lobby.startsAt === undefined) {
      // Scheduled lobbies only get a countdown once they're the active one for
      // their bucket; the one queued behind it is simply next up. Hosted
      // lobbies never get one — they start when the host says so.
      return lobby.publicGameType === "hosted"
        ? translateText("public_lobby.waiting_for_players")
        : translateText("detailed_view.queued");
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

  // ---- Filter panel ----

  private renderFilterPanel() {
    return html`
      <div
        class="flex flex-col gap-4 p-4 rounded-2xl bg-black/20 border border-white/10"
      >
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          ${this.renderChipGroup(
            translateText("detailed_view.mode"),
            LOBBY_MODES.map((mode) => ({
              value: mode,
              label: translateText(`detailed_view.mode_${mode}`),
              active: this.filters.modes.includes(mode),
            })),
            (value) =>
              this.patchFilters({
                modes: toggle(this.filters.modes, value as LobbyModeFilter),
              }),
          )}
          ${this.renderChipGroup(
            translateText("detailed_view.source"),
            LOBBY_SOURCES.map((source) => ({
              value: source,
              label: translateText(`detailed_view.source_${source}`),
              active: this.filters.sources.includes(source),
            })),
            (value) =>
              this.patchFilters({
                sources: toggle(
                  this.filters.sources,
                  value as LobbySourceFilter,
                ),
              }),
          )}
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          ${this.renderChipGroup(
            translateText("detailed_view.per_team"),
            NAMED_TEAM_CONFIGS.map((name) => ({
              value: name as string,
              label: translateText(
                `detailed_view.layout_${name.toLowerCase()}`,
              ),
              active: this.filters.teamConfigs.includes(name),
            })),
            (value) => this.toggleTeamConfig(value),
          )}
          ${this.renderChipGroup(
            translateText("detailed_view.team_count"),
            NUMERIC_TEAM_CONFIGS.map((count) => ({
              value: count,
              label: count,
              active: this.filters.teamConfigs.includes(count),
            })),
            (value) => this.toggleTeamConfig(value),
          )}
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          ${this.renderRange(
            translateText("detailed_view.joined_players"),
            "minJoined",
            "maxJoined",
          )}
          ${this.renderRange(
            translateText("detailed_view.capacity"),
            "minCapacity",
            "maxCapacity",
          )}
          ${this.renderRange(
            translateText("detailed_view.team_size"),
            "minTeamSize",
            "maxTeamSize",
          )}
        </div>

        <div class="flex items-center justify-between gap-3 flex-wrap">
          <label
            class="flex items-center gap-2 text-xs text-white/70 cursor-pointer"
          >
            <input
              type="checkbox"
              class="w-4 h-4 accent-malibu-blue"
              .checked=${this.filters.hideEmpty}
              @change=${(e: Event) =>
                this.patchFilters({
                  hideEmpty: (e.target as HTMLInputElement).checked,
                })}
            />
            ${translateText("detailed_view.hide_empty")}
          </label>
          <button @click=${() => this.resetFilters()} class="${BUTTON_CLASS}">
            ${translateText("detailed_view.reset")}
          </button>
        </div>

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
      <div>
        <span class="${SECTION_LABEL}">${label}</span>
        <div class="flex flex-wrap gap-1.5">
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
      </div>
    `;
  }

  private renderRange(label: string, minKey: BoundKey, maxKey: BoundKey) {
    return html`
      <div>
        <span class="${SECTION_LABEL}">${label}</span>
        <div class="flex items-center gap-2">
          <input
            type="number"
            min="0"
            class="${FIELD_CLASS} w-full min-w-0 text-center"
            aria-label="${label} ${translateText("detailed_view.min")}"
            placeholder=${translateText("detailed_view.min")}
            .value=${boundValue(this.filters[minKey])}
            @change=${(e: Event) => this.setBound(minKey, e)}
          />
          <span class="text-xs text-white/30">–</span>
          <input
            type="number"
            min="0"
            class="${FIELD_CLASS} w-full min-w-0 text-center"
            aria-label="${label} ${translateText("detailed_view.max")}"
            placeholder=${translateText("detailed_view.max")}
            .value=${boundValue(this.filters[maxKey])}
            @change=${(e: Event) => this.setBound(maxKey, e)}
          />
        </div>
      </div>
    `;
  }

  private renderProfiles() {
    const names = Object.keys(this.profiles).sort((a, b) => a.localeCompare(b));
    return html`
      <div class="pt-3 border-t border-white/10">
        <span class="${SECTION_LABEL}"
          >${translateText("detailed_view.profiles")}</span
        >
        <div class="flex flex-wrap items-center gap-2">
          ${styledSelect({
            options: [
              {
                value: "",
                label: translateText("detailed_view.no_profile"),
              },
              ...names.map((name) => ({ value: name, label: name })),
            ],
            value: this.selectedProfile,
            onChange: (value) => this.applyProfile(value),
            ariaLabel: translateText("detailed_view.profiles"),
            className: "flex-1 min-w-[8rem]",
          })}
          <input
            type="text"
            maxlength="32"
            class="${FIELD_CLASS} flex-1 min-w-[8rem]"
            placeholder=${translateText("detailed_view.profile_name")}
            aria-label=${translateText("detailed_view.profile_name")}
            .value=${this.profileName}
            @input=${(e: Event) =>
              (this.profileName = (e.target as HTMLInputElement).value)}
          />
          <button @click=${() => this.saveProfile()} class="${BUTTON_CLASS}">
            ${translateText("detailed_view.save_profile")}
          </button>
          <button
            @click=${() => this.deleteProfile()}
            ?disabled=${this.selectedProfile === ""}
            class="${BUTTON_CLASS} ${this.selectedProfile === ""
              ? "opacity-40 cursor-not-allowed"
              : ""}"
          >
            ${translateText("detailed_view.delete_profile")}
          </button>
        </div>
      </div>
    `;
  }

  // ---- Actions ----

  /** How many filters are narrowing the list, for the Filters button badge. */
  private activeFilterCount(): number {
    const f = this.filters;
    const bounds: (number | null)[] = [
      f.minJoined,
      f.maxJoined,
      f.minCapacity,
      f.maxCapacity,
      f.minTeamSize,
      f.maxTeamSize,
    ];
    return (
      (f.modes.length > 0 ? 1 : 0) +
      (f.sources.length > 0 ? 1 : 0) +
      (f.teamConfigs.length > 0 ? 1 : 0) +
      (f.hideEmpty ? 1 : 0) +
      bounds.filter((b) => b !== null).length
    );
  }

  private toggleTeamConfig(value: string) {
    this.patchFilters({ teamConfigs: toggle(this.filters.teamConfigs, value) });
  }

  private patchFilters(patch: Partial<LobbyFilters>) {
    this.filters = { ...this.filters, ...patch };
  }

  private setBound(key: BoundKey, event: Event) {
    const raw = (event.target as HTMLInputElement).value.trim();
    if (raw === "") {
      this.patchFilters({ [key]: null } as Partial<LobbyFilters>);
      return;
    }
    // Number() (not parseInt) so "12abc" is rejected outright rather than
    // silently read as 12; fractions floor, matching normalizeFilters.
    const parsed = Number(raw);
    this.patchFilters({
      [key]: Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null,
    } as Partial<LobbyFilters>);
  }

  private resetFilters() {
    this.filters = { ...DEFAULT_FILTERS };
    this.selectedProfile = "";
  }

  private applyProfile(name: string) {
    this.selectedProfile = name;
    if (name === "") return;
    const profile = hasFilterProfile(this.profiles, name)
      ? this.profiles[name]
      : undefined;
    if (profile) {
      this.filters = { ...profile };
      this.profileName = name;
    }
  }

  private saveProfile() {
    const name = this.profileName.trim();
    if (name === "") return;
    this.profiles = saveFilterProfile(name, this.filters);
    this.selectedProfile = hasFilterProfile(this.profiles, name)
      ? name
      : this.selectedProfile;
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
