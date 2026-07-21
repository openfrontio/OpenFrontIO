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

const OVERLAY_SLOT_KEYS = ["ffa", "special", "team"] as const;
const SLOT_FFA = 0;
const SLOT_SPECIAL = 1;
const SLOT_TEAM = 2;

const OVERLAY_FADE_MS = 300;

type OverlayPhase = "entering" | "video" | "fading" | "card";

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
  private overlaySlotState: Map<
    number,
    { lastGameId?: string; count: number }
  > = new Map();
  private overlayLastHandledCount = new WeakMap<LobbyCardOverlay, number>();
  private overlayTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private overlayDismissTimers: Map<number, ReturnType<typeof setTimeout>> =
    new Map();

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
    for (const timer of this.overlayDismissTimers.values()) {
      clearTimeout(timer);
    }
    this.overlayDismissTimers.clear();
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
        this.mapAspectRatios = new Map(this.mapAspectRatios).set(mapType, 1);
        const mapData = terrainMapFileLoader.getMapData(mapType);
        mapData
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
        new Image().src = mapData.webpPath;
      }
    }

    this.checkOverlayTriggers();
  }

  private checkOverlayTriggers() {
    const slotsSeen = new Set<number>();
    for (const overlay of this.overlays) {
      if (slotsSeen.has(overlay.slot)) continue;
      slotsSeen.add(overlay.slot);

      const slotKey = OVERLAY_SLOT_KEYS[overlay.slot];
      const lobby = slotKey ? this.lobbies?.games?.[slotKey]?.[0] : undefined;
      if (!lobby) continue;

      const slotState = this.overlaySlotState.get(overlay.slot) ?? {
        count: 0,
      };
      if (lobby.gameID === slotState.lastGameId) continue;

      slotState.lastGameId = lobby.gameID;
      slotState.count += 1;
      this.overlaySlotState.set(overlay.slot, slotState);
    }

    for (const overlay of this.overlays) {
      if (overlay.interval <= 0) continue;
      const slotState = this.overlaySlotState.get(overlay.slot);
      if (!slotState) continue;
      if (this.overlayLastHandledCount.get(overlay) === slotState.count) {
        continue;
      }
      this.overlayLastHandledCount.set(overlay, slotState.count);

      if (this.activeOverlays.has(overlay.slot)) continue;
      if ((slotState.count + overlay.offset) % overlay.interval === 0) {
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
    this.setActiveOverlay(slot, { slot, overlay, phase: "entering" });
    setTimeout(() => this.handleVideoReady(slot), 800);
    this.setOverlayTimer(slot, (overlay.video.videoLength + 2) * 1000, () =>
      this.advanceOverlayToFading(slot),
    );
    const existingDismiss = this.overlayDismissTimers.get(slot);
    if (existingDismiss) clearTimeout(existingDismiss);
    this.overlayDismissTimers.set(
      slot,
      setTimeout(() => this.dismissOverlay(slot), overlay.ttl),
    );
  }

  private handleVideoReady(slot: number) {
    const active = this.activeOverlays.get(slot);
    if (active?.phase === "entering") {
      this.setActiveOverlay(slot, { ...active, phase: "video" });
    }
  }

  private handleVideoTimeUpdate(slot: number, e: Event) {
    const video = e.currentTarget as HTMLVideoElement;
    if (!isFinite(video.duration)) return;
    if (video.duration - video.currentTime <= OVERLAY_FADE_MS / 1000) {
      this.advanceOverlayToFading(slot);
    }
  }

  private advanceOverlayToFading(slot: number) {
    const active = this.activeOverlays.get(slot);
    if (!active || (active.phase !== "video" && active.phase !== "entering")) {
      return;
    }
    this.setActiveOverlay(slot, { ...active, phase: "fading" });
    this.setOverlayTimer(slot, OVERLAY_FADE_MS, () =>
      this.advanceOverlayToCard(slot),
    );
  }

  private advanceOverlayToCard(slot: number) {
    const active = this.activeOverlays.get(slot);
    if (!active || active.phase !== "fading") return;
    // No dismiss timer scheduled here: the total-ttl timer from
    // triggerOverlay is already pending and covers this phase too.
    this.setActiveOverlay(slot, { ...active, phase: "card" });
  }

  private dismissOverlay(slot: number) {
    if (!this.activeOverlays.has(slot)) return;
    this.clearOverlayTimer(slot);
    const dismissTimer = this.overlayDismissTimers.get(slot);
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      this.overlayDismissTimers.delete(slot);
    }
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

  private renderCard(slot: number, lobby: PublicGameInfo) {
    const active = this.activeOverlays.get(slot);
    if (active) {
      return this.renderOverlayCard(active);
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
      lobby.gameConfig?.doomsdayClock?.speed,
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

  private renderOverlayCard(active: ActiveOverlay) {
    const { overlay, phase, slot } = active;
    const showVideo = phase !== "card";
    const showReveal = phase === "fading" || phase === "card";

    return html`
      <div
        class="group relative w-full h-44 sm:h-full text-white uppercase rounded-2xl overflow-hidden transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] bg-surface hover:shadow-[var(--shadow-lobby-card-hover)]"
      >
        <a
          href="${overlay.linkTo}"
          target="_blank"
          rel="noopener noreferrer"
          class="absolute inset-0 flex flex-col"
        >
          <div class="flex-1 min-h-0 flex items-center gap-3 px-3 py-2">
            ${showReveal
              ? html`
                  <h3
                    class="flex-1 min-w-0 text-base sm:text-xl font-bold uppercase tracking-wider leading-snug"
                  >
                    ${overlay.displayInfo.title}
                  </h3>
                  ${overlay.image.url
                    ? html`<img
                        src="${overlay.image.url}"
                        alt=""
                        class="shrink-0 w-14 h-14 sm:w-20 sm:h-20 object-contain"
                      />`
                    : nothing}
                `
              : nothing}
          </div>
          <div
            class="relative z-10 shrink-0 flex flex-col px-3 py-2 bg-black/55 backdrop-blur-sm rounded-b-2xl"
            style="overflow: visible;"
          >
                  ${overlay.displayInfo.count !== undefined
                    ? html`<span
                        class="absolute bottom-full right-2 mb-1 flex items-center gap-1 text-xs font-bold tracking-widest bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded"
                      >
                        ${overlay.displayInfo.count}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4 shrink-0"
                          viewBox="0 0 512 512"
                          fill="currentColor"
                        >
                          <path
                            d="M430.337,231.065H81.674c-29.701,0-53.858,24.16-53.858,53.862v49.884v15.976l15.806,2.262c9.135,1.31,16.03,9.258,16.03,18.483c0,9.225-6.891,17.173-16.022,18.482l-15.814,2.262v15.978v49.892c0,29.693,24.157,53.854,53.858,53.854h348.663c29.701,0,53.862-24.161,53.862-53.854v-49.558V391l-17.571-0.822c-9.982-0.463-17.808-8.655-17.808-18.645c0-9.982,7.826-18.174,17.815-18.646l17.564-0.83v-17.58v-49.55C484.199,255.225,460.038,231.065,430.337,231.065z M465.765,334.477c-19.686,0.936-35.371,17.14-35.371,37.056c0,19.923,15.685,36.135,35.371,37.055v49.558c0,19.565-15.864,35.428-35.428,35.428H81.674c-19.569,0-35.432-15.863-35.432-35.428v-49.892c17.991-2.579,31.836-18.011,31.836-36.722c0-18.703-13.846-34.135-31.836-36.721v-49.884c0-19.573,15.863-35.436,35.432-35.436h348.663c19.564,0,35.428,15.863,35.428,35.436V334.477z"
                          ></path>
                          <rect
                            x="133.621"
                            y="439.419"
                            width="12.19"
                            height="31.8"
                          ></rect>
                          <rect
                            x="133.621"
                            y="383.564"
                            width="12.19"
                            height="31.792"
                          ></rect>
                          <rect
                            x="133.621"
                            y="327.7"
                            width="12.19"
                            height="31.8"
                          ></rect>
                          <rect
                            x="133.621"
                            y="271.846"
                            width="12.19"
                            height="31.799"
                          ></rect>
                          <polygon
                            points="111.245,180.758 100.592,186.68 116.053,214.461 126.702,208.539"
                          ></polygon>
                          <path
                            d="M497.524,179.025l-24.095-43.311l-8.558-15.36l-15.749,7.826c-8.948,4.442-19.768,1.09-24.617-7.639c-4.865-8.721-2.001-19.687,6.492-24.95l14.952-9.266l-8.558-15.368l-24.088-43.294C398.863,1.714,366.006-7.658,340.047,6.79L35.374,176.299c-25.955,14.44-35.318,47.305-20.878,73.256l0.875,1.578c3.27-6.394,7.43-12.243,12.324-17.409c-4.803-15.643,1.762-33.044,16.636-41.326l304.681-169.51c17.1-9.518,38.674-3.368,48.192,13.732l24.088,43.302c-16.751,10.38-22.575,32.182-12.895,49.582c9.681,17.401,31.271,23.942,48.925,15.172l24.095,43.312c7.273,13.056,5.337,28.692-3.571,39.601c4.776,3.961,8.989,8.558,12.65,13.569C505.4,224.524,508.979,199.615,497.524,179.025z"
                          ></path>
                        </svg>
                      </span>`
                    : nothing}
                  <p
                    class="flex justify-end items-center gap-1 text-xs text-white/70 uppercase tracking-wider truncate"
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
            </a>
            <button
              @click=${(e: Event) => {
                e.preventDefault();
                e.stopPropagation();
                this.dismissOverlay(slot);
              }}
              aria-label="${translateText("news_box.dismiss")}"
              class="absolute top-2 right-2 p-1 rounded-full bg-black/40 text-white/70 hover:text-white transition-colors z-10"
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
        ${showVideo
          ? html`<video
              class="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity ease-out ${phase ===
              "video"
                ? "opacity-100"
                : "opacity-0"}"
              style="transition-duration: ${OVERLAY_FADE_MS}ms"
              src="${overlay.video.url}"
              autoplay
              muted
              playsinline
              @loadeddata=${() => this.handleVideoReady(slot)}
              @timeupdate=${(e: Event) => this.handleVideoTimeUpdate(slot, e)}
              @ended=${() => this.advanceOverlayToFading(slot)}
            ></video>`
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
