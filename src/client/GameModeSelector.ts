import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import type { LobbyCardOverlay } from "../core/ApiSchemas";
import {
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../core/game/Game";
import { PublicGameInfo, PublicGames } from "../core/Schemas";
import { getLobbyCardOverlays } from "./Api";
import "./components/IOSAddToHomeScreenBanner";
import { HostLobbyModal } from "./HostLobbyModal";
import { JoinLobbyModal } from "./JoinLobbyModal";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { SinglePlayerModal } from "./SinglePlayerModal";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { UsernameInput } from "./UsernameInput";
import {
  calculateServerTimeOffset,
  getMapName,
  getModifierLabels,
  getSecondsUntilServerTimestamp,
  renderDuration,
  translateText,
} from "./Utils";

const CARD_BG = "bg-surface";

// Lobby-card-overlay slots, in the order the three public-lobby card
// positions appear in render(): main ffa card, then special, then team.
const OVERLAY_SLOT_KEYS = ["ffa", "special", "team"] as const;
const SLOT_FFA = 0;
const SLOT_SPECIAL = 1;
const SLOT_TEAM = 2;

const OVERLAY_FADE_MS = 500;

type OverlayPhase = "video" | "fading" | "card";

interface ActiveOverlay {
  slot: number;
  overlay: LobbyCardOverlay;
  phase: OverlayPhase;
}

@customElement("game-mode-selector")
export class GameModeSelector extends LitElement {
  @state() private lobbies: PublicGames | null = null;
  @state() private mapAspectRatios: Map<GameMapType, number> = new Map();
  @state() private inputValid: boolean = true;
  private serverTimeOffset: number = 0;
  private defaultLobbyTime: number = 0;

  @state() private overlays: LobbyCardOverlay[] = [];
  @state() private activeOverlays: Map<number, ActiveOverlay> = new Map();
  // Per-slot count of distinct games observed, used to trigger an overlay
  // every `interval` game cycles.
  private overlaySlotState: Map<
    number,
    { lastGameId?: string; count: number }
  > = new Map();
  private overlayTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();

  private lobbySocket = new PublicLobbySocket((lobbies) =>
    this.handleLobbiesUpdate(lobbies),
  );

  createRenderRoot() {
    return this;
  }

  // Silent backstop; the buttons are already disabled while input is invalid.
  private validateUsername(): boolean {
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    return usernameInput ? usernameInput.canPlay() : true;
  }

  connectedCallback() {
    super.connectedCallback();
    this.lobbySocket.start();
    this.defaultLobbyTime = ClientEnv.gameCreationRate() / 1000;
    window.addEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    // Pick up the current value in case username-input validated before us.
    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput | null;
    if (usernameInput) {
      this.inputValid = usernameInput.canPlay();
    }
    getLobbyCardOverlays()
      .then((overlays) => {
        this.overlays = overlays;
      })
      .catch((e) => console.error("Failed to load lobby card overlays", e));
  }

  disconnectedCallback() {
    this.stop();
    window.removeEventListener(
      "username-validity-change",
      this.handleValidityChange,
    );
    for (const timer of this.overlayTimers.values()) {
      clearTimeout(timer);
    }
    this.overlayTimers.clear();
    super.disconnectedCallback();
  }

  private handleValidityChange = (e: Event) => {
    this.inputValid = (e as CustomEvent).detail?.isValid ?? true;
  };

  public stop() {
    this.lobbySocket.stop();
  }

  private handleLobbiesUpdate(lobbies: PublicGames) {
    this.lobbies = lobbies;
    this.serverTimeOffset = calculateServerTimeOffset(lobbies.serverTime);
    document.dispatchEvent(
      new CustomEvent("public-lobbies-update", {
        detail: { payload: lobbies },
      }),
    );
    this.requestUpdate();

    const allGames = Object.values(lobbies.games ?? {}).flat();
    for (const game of allGames) {
      const mapType = game.gameConfig?.gameMap as GameMapType;
      if (mapType && !this.mapAspectRatios.has(mapType)) {
        // New Map reference triggers Lit reactivity; placeholder ratio 1 lets
        // has() guard against duplicate in-flight fetches.
        this.mapAspectRatios = new Map(this.mapAspectRatios).set(mapType, 1);
        terrainMapFileLoader
          .getMapData(mapType)
          .manifest()
          .then((m: any) => {
            if (m?.map?.width && m?.map?.height) {
              this.mapAspectRatios = new Map(this.mapAspectRatios).set(
                mapType,
                m.map.width / m.map.height,
              );
            }
          })
          .catch((e) =>
            console.error(`Failed to load manifest for ${mapType}`, e),
          );
      }
    }

    this.checkOverlayTriggers();
  }

  // Bumps each overlay's per-slot game counter whenever that slot's lobby
  // changes, and triggers the overlay once the counter hits `interval`.
  private checkOverlayTriggers() {
    for (const overlay of this.overlays) {
      const slotKey = OVERLAY_SLOT_KEYS[overlay.slot];
      const lobby = slotKey ? this.lobbies?.games?.[slotKey]?.[0] : undefined;
      if (!lobby || overlay.interval <= 0) continue;

      const slotState = this.overlaySlotState.get(overlay.slot) ?? {
        count: 0,
      };
      if (lobby.gameID === slotState.lastGameId) continue;

      slotState.lastGameId = lobby.gameID;
      slotState.count += 1;
      this.overlaySlotState.set(overlay.slot, slotState);

      if (
        slotState.count % overlay.interval === 0 &&
        !this.activeOverlays.has(overlay.slot)
      ) {
        this.triggerOverlay(overlay);
      }
    }
  }

  private setOverlayTimer(slot: number, ms: number, fn: () => void) {
    const existing = this.overlayTimers.get(slot);
    if (existing) clearTimeout(existing);
    this.overlayTimers.set(slot, setTimeout(fn, ms));
  }

  private clearOverlayTimer(slot: number) {
    const existing = this.overlayTimers.get(slot);
    if (existing) {
      clearTimeout(existing);
      this.overlayTimers.delete(slot);
    }
  }

  private setActiveOverlay(slot: number, active: ActiveOverlay | null) {
    const next = new Map(this.activeOverlays);
    if (active) {
      next.set(slot, active);
    } else {
      next.delete(slot);
    }
    this.activeOverlays = next;
  }

  private triggerOverlay(overlay: LobbyCardOverlay) {
    const slot = overlay.slot;
    this.setActiveOverlay(slot, { slot, overlay, phase: "video" });
    // Fallback in case the video fails to load and 'ended' never fires.
    this.setOverlayTimer(slot, (overlay.video.videoLength + 2) * 1000, () =>
      this.advanceOverlayToFading(slot),
    );
  }

  private advanceOverlayToFading(slot: number) {
    const active = this.activeOverlays.get(slot);
    if (!active || active.phase !== "video") return;
    this.setActiveOverlay(slot, { ...active, phase: "fading" });
    this.setOverlayTimer(slot, OVERLAY_FADE_MS, () =>
      this.advanceOverlayToCard(slot),
    );
  }

  private advanceOverlayToCard(slot: number) {
    const active = this.activeOverlays.get(slot);
    if (!active || active.phase !== "fading") return;
    this.setActiveOverlay(slot, { ...active, phase: "card" });
    this.setOverlayTimer(slot, active.overlay.ttl, () =>
      this.dismissOverlay(slot),
    );
  }

  private dismissOverlay(slot: number) {
    if (!this.activeOverlays.has(slot)) return;
    this.clearOverlayTimer(slot);
    this.setActiveOverlay(slot, null);
  }

  render() {
    const ffa = this.lobbies?.games?.["ffa"]?.[0];
    const teams = this.lobbies?.games?.["team"]?.[0];
    const special = this.lobbies?.games?.["special"]?.[0];

    return html`
      <div class="flex flex-col gap-4 w-full px-4 sm:px-0 mx-auto pb-4 sm:pb-0">
        <!-- Solo: mobile only, top -->
        <div class="sm:hidden h-14">
          ${this.renderSmallActionCard(
            translateText("main.solo"),
            this.openSinglePlayerModal,
            "bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 hover:scale-y-105 hover:scale-x-[1.01]",
          )}
        </div>
        <!-- Create/ranked/join: mobile only, below solo -->
        <div class="sm:hidden grid grid-cols-3 gap-4 h-14">
          ${this.renderSmallActionCard(
            translateText("main.create"),
            this.openHostLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
          )}
          ${this.renderSmallActionCard(
            translateText("mode_selector.ranked_title"),
            this.openRankedMenu,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
          )}
          ${this.renderSmallActionCard(
            translateText("main.join"),
            this.openJoinLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
            this.hostedLobbyCount(),
          )}
        </div>
        <!-- iOS Add to Home Screen banner -->
        <ios-add-to-home-screen-banner
          class="no-crazygames"
        ></ios-add-to-home-screen-banner>

        <!-- Game cards grid -->
        ${this.lobbies === null
          ? html`<div
              class="flex items-center justify-center h-44 sm:h-[min(24rem,40vh)]"
            >
              <span
                class="w-24 h-24 border-[6px] border-blue-500/30 border-t-blue-500 rounded-full animate-spin"
              ></span>
            </div>`
          : html`<div
              class="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-4 sm:h-[min(24rem,40vh)]"
            >
              <!-- Left col: main card (desktop only) -->
              ${ffa
                ? html`<div class="hidden sm:block">
                    ${this.renderCard(SLOT_FFA, ffa)}
                  </div>`
                : nothing}

              <!-- Right col: special + teams (desktop only) -->
              <div class="hidden sm:flex sm:flex-col sm:gap-4">
                ${special
                  ? html`<div class="flex-1 min-h-0">
                      ${this.renderCard(SLOT_SPECIAL, special)}
                    </div>`
                  : nothing}
                ${teams
                  ? html`<div class="flex-1 min-h-0">
                      ${this.renderCard(SLOT_TEAM, teams)}
                    </div>`
                  : nothing}
              </div>

              <!-- Mobile: special, ffa, teams inline -->
              <div class="sm:hidden">
                ${special ? this.renderCard(SLOT_SPECIAL, special) : nothing}
              </div>
              <div class="sm:hidden">
                ${ffa ? this.renderCard(SLOT_FFA, ffa) : nothing}
              </div>
              <div class="sm:hidden">
                ${teams ? this.renderCard(SLOT_TEAM, teams) : nothing}
              </div>
            </div>`}

        <!-- Solo: full width, desktop only -->
        <div class="hidden sm:block h-14">
          ${this.renderSmallActionCard(
            translateText("main.solo"),
            this.openSinglePlayerModal,
            "bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 hover:scale-y-105 hover:scale-x-[1.01]",
          )}
        </div>
        <!-- Bottom row: create + ranked + join (desktop only) -->
        <div class="hidden sm:grid grid-cols-3 gap-4 h-14">
          ${this.renderSmallActionCard(
            translateText("main.create"),
            this.openHostLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
          )}
          ${this.renderSmallActionCard(
            translateText("mode_selector.ranked_title"),
            this.openRankedMenu,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
          )}
          ${this.renderSmallActionCard(
            translateText("main.join"),
            this.openJoinLobby,
            "bg-surface hover:brightness-[1.08] active:brightness-[0.95] hover:scale-105 hover:shadow-[var(--shadow-action-card-hover)]",
            this.hostedLobbyCount(),
          )}
        </div>
      </div>
    `;
  }

  // Renders the normal lobby card for a slot, or its promo overlay when one
  // is active for that slot.
  private renderCard(slot: number, lobby: PublicGameInfo) {
    const active = this.activeOverlays.get(slot);
    if (active) {
      return this.renderNewsOverlayCard(active);
    }
    return this.renderLobbyCard(lobby, this.getLobbyTitle(lobby));
  }

  private openRankedMenu = () => {
    if (!this.validateUsername()) return;
    window.showPage?.("page-ranked");
  };

  private openSinglePlayerModal = () => {
    if (!this.validateUsername()) return;
    (
      document.querySelector("single-player-modal") as SinglePlayerModal
    )?.open();
  };

  private openHostLobby = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("host-lobby-modal") as HostLobbyModal)?.open();
  };

  private openJoinLobby = () => {
    if (!this.validateUsername()) return;
    (document.querySelector("join-lobby-modal") as JoinLobbyModal)?.open();
  };

  // Number of open hosted lobbies waiting in the browser; shown as a chip
  // on the Join button.
  private hostedLobbyCount(): number {
    return this.lobbies?.games?.hosted?.length ?? 0;
  }

  private renderSmallActionCard(
    title: string,
    onClick: () => void,
    bgClass: string = CARD_BG,
    badge?: number,
  ) {
    return html`
      <button
        @click=${onClick}
        ?disabled=${!this.inputValid}
        class="relative flex items-center justify-center w-full h-full rounded-lg ${bgClass} transition-all duration-200 text-sm lg:text-base font-medium text-white uppercase tracking-wider text-center ${!this
          .inputValid
          ? "opacity-50 cursor-not-allowed pointer-events-none"
          : ""}"
      >
        ${title}
        ${badge
          ? html`<span
              class="absolute -top-2 -right-2 min-w-[1.375rem] h-[1.375rem] px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold tracking-normal"
              >${badge}</span
            >`
          : nothing}
      </button>
    `;
  }

  private renderLobbyCard(
    lobby: PublicGameInfo,
    titleContent: string | TemplateResult,
  ) {
    const mapType = lobby.gameConfig!.gameMap as GameMapType;
    const mapImageSrc = terrainMapFileLoader.getMapData(mapType).webpPath;
    const aspectRatio = this.mapAspectRatios.get(mapType);
    // Use object-contain for extreme aspect ratios (e.g. Amazon River ~20:1) so
    // the full map is visible instead of being cropped by object-cover.
    const useContain =
      aspectRatio !== undefined && (aspectRatio > 4 || aspectRatio < 0.25);
    const timeRemaining = lobby.startsAt
      ? getSecondsUntilServerTimestamp(lobby.startsAt, this.serverTimeOffset)
      : undefined;

    let timeDisplay: string;
    let timeDisplayUppercase = false;
    if (timeRemaining === undefined) {
      timeDisplay = renderDuration(this.defaultLobbyTime);
    } else if (timeRemaining > 0) {
      timeDisplay = renderDuration(timeRemaining);
    } else {
      timeDisplay = translateText("public_lobby.starting_game");
      timeDisplayUppercase = true;
    }

    const mapName = getMapName(lobby.gameConfig?.gameMap);

    const modifierLabels = getModifierLabels(
      lobby.gameConfig?.publicGameModifiers,
    );
    // Sort by length for visual consistency (shorter labels first)
    if (modifierLabels.length > 1) {
      modifierLabels.sort((a, b) => a.length - b.length);
    }

    return html`
      <button
        @click=${() => this.validateAndJoin(lobby)}
        ?disabled=${!this.inputValid}
        class="group relative w-full h-44 sm:h-full text-white uppercase rounded-2xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] bg-surface hover:shadow-[var(--shadow-lobby-card-hover)] ${!this
          .inputValid
          ? "opacity-50 cursor-not-allowed pointer-events-none"
          : ""}"
      >
        <!-- Image clipped separately so overflow-hidden doesn't block absolute children -->
        <div
          class="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none"
        >
          ${mapImageSrc
            ? html`<img
                src="${mapImageSrc}"
                alt="${mapName ?? lobby.gameConfig?.gameMap ?? "map"}"
                draggable="false"
                class="absolute inset-0 w-full h-full ${useContain
                  ? "object-contain"
                  : "object-cover object-center scale-[1.05]"} [image-rendering:auto]"
              />`
            : null}
        </div>
        <!-- Top row: modifiers + timer -->
        <div
          class="absolute inset-x-2 top-2 flex items-start justify-between gap-2"
        >
          ${modifierLabels.length > 0
            ? html`<div class="flex flex-col items-start gap-1 mt-[2px]">
                ${modifierLabels.map(
                  (label) =>
                    html`<span
                      class="px-2 py-1 rounded text-xs font-bold uppercase tracking-widest bg-malibu-blue text-white shadow-[var(--shadow-malibu-blue-pill)]"
                      >${label}</span
                    >`,
                )}
              </div>`
            : html`<div></div>`}
          <div class="shrink-0">
            <span
              class="text-xs font-bold tracking-widest ${timeDisplayUppercase
                ? "uppercase"
                : "normal-case"} bg-malibu-blue text-white px-2 py-1 rounded"
              >${timeDisplay}</span
            >
          </div>
        </div>
        <!-- Bottom bar: map name + mode, with player count floating above -->
        <div
          class="absolute bottom-0 left-0 right-0 flex flex-col px-3 py-2 bg-black/55 backdrop-blur-sm rounded-b-2xl"
          style="overflow: visible;"
        >
          <span
            class="absolute bottom-full right-2 mb-1 flex items-center gap-1 text-xs font-bold tracking-widest bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded"
          >
            ${lobby.numClients}/${lobby.gameConfig?.maxPlayers}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 inline-block"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z"
              ></path>
            </svg>
          </span>
          ${mapName
            ? html`<p
                class="text-sm sm:text-base font-bold uppercase tracking-wider text-left leading-tight"
              >
                ${mapName}
              </p>`
            : ""}
          <h3 class="text-xs text-white/70 uppercase tracking-wider text-left">
            ${titleContent}
          </h3>
        </div>
      </button>
    `;
  }

  // Renders a triggered promo overlay: a short video that plays over the
  // card, holds on its last frame, fades out, and reveals a static info
  // card underneath (title/count, subtitle + link, image), closable early.
  private renderNewsOverlayCard(active: ActiveOverlay) {
    const { overlay, phase, slot } = active;
    const showVideo = phase !== "card";

    return html`
      <div
        class="relative w-full h-44 sm:h-full text-white rounded-2xl overflow-hidden bg-surface"
      >
        ${showVideo
          ? html`<video
              class="absolute inset-0 w-full h-full object-cover transition-opacity ease-out ${phase ===
              "fading"
                ? "opacity-0"
                : "opacity-100"}"
              style="transition-duration: ${OVERLAY_FADE_MS}ms"
              src="${overlay.video.url}"
              autoplay
              muted
              playsinline
              @ended=${() => this.advanceOverlayToFading(slot)}
            ></video>`
          : nothing}
        ${phase === "card"
          ? html`
              <a
                href="${overlay.linkTo}"
                target="_blank"
                rel="noopener noreferrer"
                class="absolute inset-0 flex items-center gap-3 px-4 py-3"
              >
                <div class="flex-1 min-w-0">
                  <h3
                    class="text-base sm:text-lg font-bold uppercase tracking-wider truncate"
                  >
                    ${overlay.displayInfo.title}
                    ${overlay.displayInfo.count !== undefined
                      ? html`<span class="text-white/60"
                          >${overlay.displayInfo.count}</span
                        >`
                      : nothing}
                  </h3>
                  <p
                    class="flex items-center gap-1 text-xs text-white/70 uppercase tracking-wider truncate"
                  >
                    ${overlay.displayInfo.subtitle}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-3 w-3 shrink-0"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z"
                        clip-rule="evenodd"
                      ></path>
                    </svg>
                  </p>
                </div>
                ${overlay.image.url
                  ? html`<img
                      src="${overlay.image.url}"
                      alt=""
                      class="w-14 h-14 sm:w-16 sm:h-16 object-contain shrink-0"
                    />`
                  : nothing}
              </a>
              <button
                @click=${(e: Event) => {
                  e.preventDefault();
                  e.stopPropagation();
                  this.dismissOverlay(slot);
                }}
                aria-label="${translateText("news_box.dismiss")}"
                class="absolute top-2 right-2 p-1 rounded-full bg-black/40 text-white/70 hover:text-white transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  class="w-3.5 h-3.5"
                >
                  <path
                    d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                  />
                </svg>
              </button>
            `
          : nothing}
      </div>
    `;
  }

  private validateAndJoin(lobby: PublicGameInfo) {
    if (!this.validateUsername()) return;

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

  private getLobbyTitle(lobby: PublicGameInfo): string {
    const config = lobby.gameConfig!;
    if (config.gameMode === GameMode.FFA) {
      return translateText("game_mode.ffa");
    }

    if (config?.gameMode === GameMode.Team) {
      const totalPlayers = config.maxPlayers ?? lobby.numClients ?? undefined;
      const formatTeamsOf = (
        teamCount: number | undefined,
        playersPerTeam: number | undefined,
        label?: string,
      ) => {
        if (!teamCount)
          return label ?? translateText("mode_selector.teams_title");
        const baseTitle = playersPerTeam
          ? translateText("mode_selector.teams_of", {
              teamCount: String(teamCount),
              playersPerTeam: String(playersPerTeam),
            })
          : translateText("mode_selector.teams_count", {
              teamCount: String(teamCount),
            });
        return `${baseTitle}${label ? ` (${label})` : ""}`;
      };

      switch (config.playerTeams) {
        case Duos: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 2)
            : undefined;
          return formatTeamsOf(teamCount, 2);
        }
        case Trios: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 3)
            : undefined;
          return formatTeamsOf(teamCount, 3);
        }
        case Quads: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 4)
            : undefined;
          return formatTeamsOf(teamCount, 4);
        }
        case HumansVsNations: {
          const humanSlots = config.maxPlayers ?? lobby.numClients;
          return humanSlots
            ? translateText("public_lobby.teams_hvn_detailed", {
                num: String(humanSlots),
              })
            : translateText("public_lobby.teams_hvn");
        }
        default:
          if (typeof config.playerTeams === "number") {
            const teamCount = config.playerTeams;
            const playersPerTeam =
              totalPlayers && teamCount > 0
                ? Math.floor(totalPlayers / teamCount)
                : undefined;
            return formatTeamsOf(teamCount, playersPerTeam);
          }
      }
    }

    return "";
  }
}
