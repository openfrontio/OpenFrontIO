/**
 * Lobby bridges consolidated in one module.
 */

import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";
import {
  Difficulty,
  Duos,
  GameMapSize,
  GameMapType,
  GameMode,
  HumansVsNations,
  PublicGameModifiers,
  Quads,
  Trios,
  UnitType,
  mapCategories,
} from "../core/game/Game";
import {
  ClientInfo,
  GAME_ID_REGEX,
  GameConfig,
  GameID,
  GameInfo,
  isValidGameID,
  TeamCountConfig,
} from "../core/Schemas";
import { generateID } from "../core/Util";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { PublicLobbySocket } from "./LobbySocket";
import { JoinLobbyEvent } from "./Main";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { renderDuration, translateText } from "./Utils";
import {
  dispatchUiAction,
  dispatchUiSnapshot,
  initDioxusRuntime,
} from "./UiRuntimeBridge";
import { subscribeUiRuntimeEvents } from "./runtime/UiRuntimeEventRouter";
import {
  parseUiRuntimePayload,
  parseUiRuntimeString,
} from "./runtime/UiRuntimeParsing";
import {
  UI_RUNTIME_ACTIONS,
  UI_RUNTIME_EVENTS,
  UI_RUNTIME_SNAPSHOTS,
} from "./runtime/UiRuntimeProtocol";
import {
  ensureUiApiMutationRuntimeStarted,
  requestHostLobbyCreate,
  requestHostLobbyStart,
} from "./runtime/UiApiMutationRuntime";
import {
  ensureUiApiReadRuntimeStarted,
  requestLobbyArchiveRead,
  requestLobbyExistsRead,
  requestLobbyStateRead,
} from "./runtime/UiApiReadRuntime";

interface HostLobbyFormState {
  selectedMap: string;
  selectedDifficulty: string;
  gameMode: string;
  teamCount: string;
  useRandomMap: boolean;
  disableNations: boolean;
  bots: number;
  spawnImmunity: boolean;
  spawnImmunityMinutes: number | null;
  infiniteGold: boolean;
  donateGold: boolean;
  infiniteTroops: boolean;
  donateTroops: boolean;
  compactMap: boolean;
  maxTimer: boolean;
  maxTimerValue: number | null;
  instantBuild: boolean;
  randomSpawn: boolean;
  goldMultiplier: boolean;
  goldMultiplierValue: number | null;
  startingGold: boolean;
  startingGoldValue: number | null;
  disabledUnits: string[];
  isHvnTeamMode: boolean;
}

function dispatchLobbyRuntimeAction(
  actionType: string,
  payload: Record<string, unknown> = {},
): boolean {
  const dispatched = dispatchUiAction({
    type: actionType,
    payload,
  });
  if (!dispatched) {
    console.warn("[LobbyBridges] Failed runtime action:", actionType);
  }
  return dispatched;
}

function dispatchLobbyRuntimeSnapshot(
  snapshotType: string,
  payload: Record<string, unknown>,
): boolean {
  const dispatched = dispatchUiSnapshot({
    type: snapshotType,
    payload,
  });
  if (!dispatched) {
    console.warn("[LobbyBridges] Failed runtime snapshot:", snapshotType);
  }
  return dispatched;
}

@customElement("dioxus-host-lobby-modal")
export class DioxusHostLobbyModal extends LitElement {
  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  @state()
  isVisible = false;

  private lobbyId = "";
  private lobbyUrlSuffix = "";
  private lobbyCreatorClientID = "";
  private playersInterval: ReturnType<typeof setInterval> | null = null;
  private botsUpdateTimer: number | null = null;
  private leaveLobbyOnClose = true;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiApiMutationRuntimeStarted();
    void ensureUiApiReadRuntimeStarted();
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.cleanupListeners();
    this.cleanupTimers();
    super.disconnectedCallback();
  }

  private cleanupListeners() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
  }

  private cleanupTimers() {
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
    if (this.botsUpdateTimer !== null) {
      clearTimeout(this.botsUpdateTimer);
      this.botsUpdateTimer = null;
    }
  }

  private getTranslations() {
    return {
      title: translateText("host_modal.title"),
      mapTitle: translateText("map.map"),
      difficultyTitle: translateText("difficulty.difficulty"),
      modeTitle: translateText("host_modal.mode"),
      optionsTitle: translateText("host_modal.options_title"),
      enablesTitle: translateText("host_modal.enables_title"),
      teamCountTitle: translateText("host_modal.team_count"),
      ffa: translateText("game_mode.ffa"),
      teams: translateText("game_mode.teams"),
      botsLabel: translateText("host_modal.bots"),
      botsDisabled: translateText("host_modal.bots_disabled"),
      disableNations: translateText("host_modal.disable_nations"),
      instantBuild: translateText("host_modal.instant_build"),
      randomSpawn: translateText("host_modal.random_spawn"),
      donateGold: translateText("host_modal.donate_gold"),
      donateTroops: translateText("host_modal.donate_troops"),
      infiniteGold: translateText("host_modal.infinite_gold"),
      infiniteTroops: translateText("host_modal.infinite_troops"),
      compactMap: translateText("host_modal.compact_map"),
      maxTimer: translateText("host_modal.max_timer"),
      minsPlaceholder: translateText("host_modal.mins_placeholder"),
      spawnImmunity: translateText("host_modal.player_immunity_duration"),
      goldMultiplier: translateText("single_modal.gold_multiplier"),
      goldMultiplierPlaceholder: translateText(
        "single_modal.gold_multiplier_placeholder",
      ),
      startingGold: translateText("single_modal.starting_gold"),
      startingGoldPlaceholder: translateText(
        "single_modal.starting_gold_placeholder",
      ),
      start: translateText("host_modal.start"),
      waiting: translateText("host_modal.waiting"),
      back: translateText("common.back"),
      special: translateText("map_categories.special"),
      randomMap: translateText("map.random"),
      copyLink: translateText("host_modal.copy_link") || "Copy Link",
      copied: translateText("host_modal.copied") || "Copied!",
      kick: translateText("host_modal.kick") || "Kick",
      hostBadge: translateText("host_modal.host") || "Host",
    };
  }

  private async getMapCategories() {
    const categories: Array<{
      key: string;
      label: string;
      maps: Array<{
        key: string;
        value: GameMapType;
        label: string;
        imageUrl: string;
      }>;
    }> = [];
    for (const [categoryKey, maps] of Object.entries(mapCategories)) {
      const mapOptions: Array<{
        key: string;
        value: GameMapType;
        label: string;
        imageUrl: string;
      }> = [];
      for (const mapValue of maps) {
        const mapKey = Object.keys(GameMapType).find(
          (key) =>
            GameMapType[key as keyof typeof GameMapType] === mapValue,
        );
        let imageUrl = "";
        try {
          const data = terrainMapFileLoader.getMapData(mapValue);
          imageUrl = await data.webpPath();
        } catch {
          // ignore
        }
        mapOptions.push({
          key: mapKey ?? "",
          value: mapValue,
          label: translateText(`map.${mapKey?.toLowerCase()}`),
          imageUrl,
        });
      }
      categories.push({
        key: categoryKey,
        label: translateText(`map_categories.${categoryKey}`),
        maps: mapOptions,
      });
    }
    return categories;
  }

  private getDifficulties() {
    return Object.entries(Difficulty)
      .filter(([key]) => isNaN(Number(key)))
      .map(([key, value]) => ({
        key,
        value: value as string,
        label: translateText(`difficulty.${key.toLowerCase()}`),
        iconUrl: "",
      }));
  }

  private getUnitOptions() {
    const unitOptions = [
      { type: UnitType.City, translationKey: "unit_type.city" },
      { type: UnitType.DefensePost, translationKey: "unit_type.defense_post" },
      { type: UnitType.Port, translationKey: "unit_type.port" },
      { type: UnitType.Warship, translationKey: "unit_type.warship" },
      {
        type: UnitType.MissileSilo,
        translationKey: "unit_type.missile_silo",
      },
      { type: UnitType.SAMLauncher, translationKey: "unit_type.sam_launcher" },
      { type: UnitType.AtomBomb, translationKey: "unit_type.atom_bomb" },
      {
        type: UnitType.HydrogenBomb,
        translationKey: "unit_type.hydrogen_bomb",
      },
      { type: UnitType.MIRV, translationKey: "unit_type.mirv" },
      { type: UnitType.Factory, translationKey: "unit_type.factory" },
    ];
    return unitOptions.map((u) => ({
      unitType: u.type,
      label: translateText(u.translationKey),
    }));
  }

  private getTeamCountOptions() {
    const options: TeamCountConfig[] = [
      2,
      3,
      4,
      5,
      6,
      7,
      Quads,
      Trios,
      Duos,
      HumansVsNations,
    ];
    return options.map((o) => ({
      value: String(o),
      label:
        typeof o === "string"
          ? o === HumansVsNations
            ? translateText("public_lobby.teams_hvn")
            : translateText(`host_modal.teams_${o}`)
          : translateText("public_lobby.teams", { num: o }),
      isString: typeof o === "string",
    }));
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();
      const mapCats = await this.getMapCategories();
      const difficulties = this.getDifficulties();
      const unitOptions = this.getUnitOptions();
      const teamCountOptions = this.getTeamCountOptions();

      dispatchLobbyRuntimeAction(UI_RUNTIME_ACTIONS.uiHostLobbyModalLaunch, {
        translations,
        maps: mapCats,
        difficulties,
        unitOptions,
        teamCountOptions,
      });
      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [
          UI_RUNTIME_EVENTS.uiLobbyHostModalCloseRequest,
          UI_RUNTIME_EVENTS.uiLobbyHostModalStartRequest,
          UI_RUNTIME_EVENTS.uiLobbyHostModalFormChange,
          UI_RUNTIME_EVENTS.uiLobbyHostModalCopyLinkRequest,
          UI_RUNTIME_EVENTS.uiLobbyHostModalKickRequest,
        ],
        (event) => {
          if (event.type === UI_RUNTIME_EVENTS.uiLobbyHostModalCloseRequest) {
            this.handleClose();
            return;
          }
          if (event.type === UI_RUNTIME_EVENTS.uiLobbyHostModalStartRequest) {
            void this.startGame();
            return;
          }
          if (
            event.type === UI_RUNTIME_EVENTS.uiLobbyHostModalCopyLinkRequest
          ) {
            void this.copyLobbyLink();
            return;
          }
          if (event.type === UI_RUNTIME_EVENTS.uiLobbyHostModalKickRequest) {
            const payload = parseUiRuntimePayload(event.payload);
            const clientId = parseUiRuntimeString(payload.clientId).trim();
            if (clientId) {
              this.kickPlayer(clientId);
            }
            return;
          }

          const payload = parseUiRuntimePayload(event.payload);
          const formJson = parseUiRuntimeString(payload.formJson);
          if (!formJson) {
            return;
          }

          try {
            const form: HostLobbyFormState = JSON.parse(formJson);
            void this.putGameConfig(form);
          } catch (error) {
            console.warn("[DioxusHostLobbyModal] Invalid form JSON:", error);
          }
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusHostLobbyModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private getRandomString(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  }

  private async buildLobbyUrl(): Promise<string> {
    const config = await getServerConfigFromClient();
    return `${window.location.origin}/${config.workerPath(this.lobbyId)}/game/${this.lobbyId}?lobby&s=${encodeURIComponent(this.lobbyUrlSuffix)}`;
  }

  private async constructUrl(): Promise<string> {
    this.lobbyUrlSuffix = this.getRandomString();
    return await this.buildLobbyUrl();
  }

  private updateHistory(url: string): void {
    history.replaceState(null, "", url);
  }

  async show() {
    this.isVisible = true;
    this.leaveLobbyOnClose = true;
    this.lobbyCreatorClientID = generateID();

    // Create lobby
    try {
      const lobby = await this.createLobby(this.lobbyCreatorClientID);
      this.lobbyId = lobby.gameID;
      if (!isValidGameID(this.lobbyId)) {
        throw new Error(`Invalid lobby ID format: ${this.lobbyId}`);
      }
      crazyGamesSDK.showInviteButton(this.lobbyId);
      const url = await this.constructUrl();
      this.updateHistory(url);

      // Dispatch join-lobby event
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: this.lobbyId,
            clientID: this.lobbyCreatorClientID,
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      console.error("Failed to create lobby:", error);
    }

    // Start player polling
    this.playersInterval = setInterval(() => this.pollPlayers(), 1000);

    if (this.isLaunched) {
      dispatchLobbyRuntimeAction(UI_RUNTIME_ACTIONS.uiHostLobbyModalShow);
    }

    this.requestUpdate();
  }

  async open() {
    await this.show();
  }

  private handleClose() {
    this.isVisible = false;
    if (this.leaveLobbyOnClose) {
      this.leaveLobby();
      this.updateHistory("/");
    }
    crazyGamesSDK.hideInviteButton();
    this.cleanupTimers();

    // Reset state
    this.lobbyId = "";
    this.lobbyCreatorClientID = "";

    this.requestUpdate();
  }

  async hide() {
    this.isVisible = false;
    if (this.isLaunched) {
      dispatchLobbyRuntimeAction(UI_RUNTIME_ACTIONS.uiHostLobbyModalHide);
    }
    this.requestUpdate();
  }

  close() {
    this.handleClose();
    void this.hide();
  }

  private leaveLobby() {
    if (!this.lobbyId) return;
    this.dispatchEvent(
      new CustomEvent("leave-lobby", {
        detail: { lobby: this.lobbyId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async putGameConfig(form: HostLobbyFormState) {
    const spawnImmunityTicks = form.spawnImmunityMinutes
      ? form.spawnImmunityMinutes * 60 * 10
      : 0;

    const url = await this.constructUrl();
    this.updateHistory(url);

    this.dispatchEvent(
      new CustomEvent("update-game-config", {
        detail: {
          config: {
            gameMap: form.selectedMap as GameMapType,
            gameMapSize: form.compactMap
              ? GameMapSize.Compact
              : GameMapSize.Normal,
            difficulty: form.selectedDifficulty as Difficulty,
            bots: form.bots,
            infiniteGold: form.infiniteGold,
            donateGold: form.donateGold,
            infiniteTroops: form.infiniteTroops,
            donateTroops: form.donateTroops,
            instantBuild: form.instantBuild,
            randomSpawn: form.randomSpawn,
            gameMode: form.gameMode as GameMode,
            disabledUnits: form.disabledUnits as UnitType[],
            spawnImmunityDuration: form.spawnImmunity
              ? spawnImmunityTicks
              : undefined,
            playerTeams: this.parseTeamCount(form.teamCount),
            ...(form.gameMode === GameMode.Team &&
            form.teamCount === HumansVsNations
              ? { disableNations: false }
              : { disableNations: form.disableNations }),
            maxTimerValue: form.maxTimer
              ? (form.maxTimerValue ?? undefined)
              : undefined,
            goldMultiplier: form.goldMultiplier
              ? (form.goldMultiplierValue ?? undefined)
              : undefined,
            startingGold: form.startingGold
              ? (form.startingGoldValue ?? undefined)
              : undefined,
          } satisfies Partial<GameConfig>,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private parseTeamCount(tc: string): TeamCountConfig {
    const num = parseInt(tc, 10);
    if (!isNaN(num)) return num;
    return tc as TeamCountConfig;
  }

  private async startGame() {
    if (!this.lobbyId) return;
    console.log("Starting private game");
    this.leaveLobbyOnClose = false;
    try {
      await requestHostLobbyStart(this.lobbyId, "open");
    } catch (error) {
      this.leaveLobbyOnClose = true;
      console.warn("Failed to start private game:", error);
    }
  }

  private async pollPlayers() {
    if (!this.lobbyId) return;
    try {
      const detail = await requestLobbyStateRead(this.lobbyId, "open");
      const data = detail.gameInfo;
      const clients = data.clients ?? [];

      if (this.isLaunched) {
        const players = clients.map((c: ClientInfo) => ({
          clientId: c.clientID,
          username: c.username,
          isHost: c.clientID === this.lobbyCreatorClientID,
        }));
        dispatchLobbyRuntimeSnapshot(
          UI_RUNTIME_SNAPSHOTS.uiSnapshotLobbyHostPlayers,
          {
            players,
          },
        );
      }
    } catch {
      // ignore polling errors
    }
  }

  private kickPlayer(clientID: string) {
    this.dispatchEvent(
      new CustomEvent("kick-player", {
        detail: { target: clientID },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async copyLobbyLink() {
    try {
      const url = await this.buildLobbyUrl();
      await navigator.clipboard.writeText(url);
    } catch {
      console.warn("Failed to copy lobby link");
    }
  }

  private async createLobby(
    creatorClientID: string,
  ): Promise<GameInfo> {
    return requestHostLobbyCreate(creatorClientID, "open");
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-host-lobby-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-host-lobby-modal": DioxusHostLobbyModal;
  }
}

@customElement("dioxus-join-private-lobby-modal")
export class DioxusJoinPrivateLobbyModal extends LitElement {
  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  private hasJoined = false;
  private currentLobbyId = "";
  private leaveLobbyOnClose = true;
  private playersInterval: ReturnType<typeof setInterval> | null = null;
  private gameConfig: GameConfig | null = null;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiApiReadRuntimeStarted();
    this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
      [
        UI_RUNTIME_EVENTS.uiLobbyJoinPrivateJoinLobby,
        UI_RUNTIME_EVENTS.uiLobbyJoinPrivatePasteRequest,
        UI_RUNTIME_EVENTS.uiLobbyJoinPrivateCloseRequest,
      ],
      (event) => {
        if (
          event.type === UI_RUNTIME_EVENTS.uiLobbyJoinPrivatePasteRequest
        ) {
          void this.handlePasteRequest();
          return;
        }
        if (
          event.type === UI_RUNTIME_EVENTS.uiLobbyJoinPrivateCloseRequest
        ) {
          this.handleModalClose();
          return;
        }

        const payload = parseUiRuntimePayload(event.payload);
        const lobbyId = parseUiRuntimeString(payload.lobbyId).trim();
        if (lobbyId) {
          void this.handleJoinLobby(lobbyId);
        }
      },
    );
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
    super.disconnectedCallback();
  }

  private handleJoinLobby = async (lobbyId: string) => {
    this.joinLobby(lobbyId);
  };

  private handlePasteRequest = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      const extracted = this.extractLobbyIdFromUrl(clipText.trim());
      dispatchLobbyRuntimeAction(
        UI_RUNTIME_ACTIONS.uiJoinPrivateLobbyUpdateLobbyId,
        {
          lobbyId: extracted,
        },
      );
    } catch (err) {
      console.error("Failed to read clipboard contents:", err);
    }
  };

  private handleModalClose = () => {
    this.closeAndLeave();
  };

  private getTranslations() {
    return {
      title: translateText("private_lobby.title"),
      enterId: translateText("private_lobby.enter_id"),
      paste: translateText("common.paste"),
      joinLobby: translateText("private_lobby.join_lobby"),
      joinedWaiting: translateText("private_lobby.joined_waiting"),
      back: translateText("common.close"),
    };
  }

  private async ensureLaunched() {
    if (this.isLaunched) return;

    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchLobbyRuntimeAction(
        UI_RUNTIME_ACTIONS.uiJoinPrivateLobbyModalLaunch,
        {
          translations,
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusJoinPrivateLobbyModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  async open(id: string = "") {
    await this.ensureLaunched();
    this.hasJoined = false;
    this.currentLobbyId = "";
    this.leaveLobbyOnClose = true;
    this.gameConfig = null;

    dispatchLobbyRuntimeAction(UI_RUNTIME_ACTIONS.uiJoinPrivateLobbyModalOpen);

    if (id) {
      const extracted = this.extractLobbyIdFromUrl(id);
      dispatchLobbyRuntimeAction(
        UI_RUNTIME_ACTIONS.uiJoinPrivateLobbyUpdateLobbyId,
        {
          lobbyId: extracted,
        },
      );
      this.joinLobby(extracted);
    }
  }

  close() {
    if (this.isLaunched) {
      dispatchLobbyRuntimeAction(UI_RUNTIME_ACTIONS.uiJoinPrivateLobbyModalClose);
    }
  }

  closeAndLeave() {
    if (this.playersInterval) {
      clearInterval(this.playersInterval);
      this.playersInterval = null;
    }
    if (this.leaveLobbyOnClose && this.currentLobbyId && this.hasJoined) {
      this.dispatchEvent(
        new CustomEvent("leave-lobby", {
          detail: { lobby: this.currentLobbyId },
          bubbles: true,
          composed: true,
        }),
      );
      history.replaceState(null, "", window.location.origin + "/");
    }
    this.hasJoined = false;
    this.currentLobbyId = "";
    this.gameConfig = null;
    this.leaveLobbyOnClose = true;
    this.close();
  }

  private extractLobbyIdFromUrl(input: string): string {
    if (!input.startsWith("http")) return input;
    try {
      const url = new URL(input);
      const match = url.pathname.match(/game\/([^/]+)/);
      const candidate = match?.[1];
      if (candidate && GAME_ID_REGEX.test(candidate)) return candidate;
      return input;
    } catch {
      return input;
    }
  }

  private normalizeLobbyId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const extracted = this.extractLobbyIdFromUrl(trimmed).trim();
    if (!GAME_ID_REGEX.test(extracted)) return null;
    return extracted;
  }

  private showMessage(message: string, color: "green" | "red" = "green") {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: { message, duration: 3000, color },
      }),
    );
  }

  private async joinLobby(rawId: string): Promise<void> {
    const lobbyId = this.normalizeLobbyId(rawId);
    if (!lobbyId) {
      this.showMessage(translateText("private_lobby.not_found"), "red");
      return;
    }

    this.currentLobbyId = lobbyId;
    dispatchLobbyRuntimeAction(UI_RUNTIME_ACTIONS.uiJoinPrivateLobbyUpdateLobbyId, {
      lobbyId,
    });

    try {
      const gameExists = await this.checkActiveLobby(lobbyId);
      if (gameExists) return;

      switch (await this.checkArchivedGame(lobbyId)) {
        case "success":
          return;
        case "not_found":
          this.showMessage(translateText("private_lobby.not_found"), "red");
          return;
        case "version_mismatch":
          this.showMessage(
            translateText("private_lobby.version_mismatch"),
            "red",
          );
          return;
        case "error":
          this.showMessage(translateText("private_lobby.error"), "red");
          return;
      }
    } catch (error) {
      console.error("Error checking lobby existence:", error);
      this.showMessage(translateText("private_lobby.error"), "red");
    }
  }

  private async checkActiveLobby(lobbyId: string): Promise<boolean> {
    const detail = await requestLobbyExistsRead(lobbyId, "open");
    if (detail.exists) {
      this.showMessage(translateText("private_lobby.joined_waiting"));
      this.hasJoined = true;
      this.leaveLobbyOnClose = false;

      dispatchLobbyRuntimeAction(
        UI_RUNTIME_ACTIONS.uiJoinPrivateLobbyUpdateJoined,
        {
          hasJoined: true,
        },
      );

      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobbyId,
            clientID: generateID(),
          } as JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );

      this.pollPlayers();
      this.playersInterval = setInterval(() => this.pollPlayers(), 1000);
      return true;
    }

    return false;
  }

  private async checkArchivedGame(
    lobbyId: string,
  ): Promise<"success" | "not_found" | "version_mismatch" | "error"> {
    const detail = await requestLobbyArchiveRead(lobbyId, "open");
    if (detail.status === 404) return "not_found";
    if (detail.status !== 200) return "error";
    if (!detail.record) return "version_mismatch";

    if (
      window.GIT_COMMIT !== "DEV" &&
      detail.record.gitCommit !== window.GIT_COMMIT
    ) {
      return "version_mismatch";
    }

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: lobbyId,
          gameRecord: detail.record,
          clientID: generateID(),
        } as JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    return "success";
  }

  private async pollPlayers() {
    const lobbyId = this.currentLobbyId;
    if (!lobbyId) return;

    try {
      const detail = await requestLobbyStateRead(lobbyId, "open");
      const data = detail.gameInfo;
      const players = data.clients ?? [];

      if (data.gameConfig) {
        this.gameConfig = data.gameConfig;
      }

      if (this.gameConfig) {
        dispatchLobbyRuntimeSnapshot(
          UI_RUNTIME_SNAPSHOTS.uiSnapshotLobbyJoinPrivateConfigHtml,
          {
            html: this.renderConfigHtml(this.gameConfig),
          },
        );
      }

      if (players.length > 0) {
        dispatchLobbyRuntimeSnapshot(
          UI_RUNTIME_SNAPSHOTS.uiSnapshotLobbyJoinPrivatePlayersHtml,
          {
            html: this.renderPlayersHtml(players),
          },
        );
      }
    } catch (error) {
      console.error("Error polling players:", error);
    }
  }

  private renderConfigHtml(c: GameConfig): string {
    const mapName = translateText(
      "map." + c.gameMap.toLowerCase().replace(/ /g, ""),
    );
    const modeName =
      c.gameMode === "Free For All"
        ? translateText("game_mode.ffa")
        : translateText("game_mode.teams");
    const diffName = translateText(
      "difficulty." + c.difficulty.toLowerCase().replace(/ /g, ""),
    );

    const item = (label: string, value: string) =>
      `<div class="bg-white/5 border border-white/10 rounded-lg p-3 flex flex-col items-center justify-center gap-1 text-center min-w-[100px]">
        <span class="text-white/40 text-[10px] font-bold uppercase tracking-wider">${label}</span>
        <span class="text-white font-bold text-sm w-full break-words hyphens-auto">${value}</span>
      </div>`;

    let html = `<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">`;
    html += item(translateText("map.map"), mapName);
    html += item(translateText("host_modal.mode"), modeName);
    html += item(translateText("difficulty.difficulty"), diffName);
    html += item(translateText("host_modal.bots"), c.bots.toString());
    html += `</div>`;

    return html;
  }

  private renderPlayersHtml(players: ClientInfo[]): string {
    let html = `<div class="space-y-2">`;
    for (const player of players) {
      html += `<div class="flex items-center gap-3 p-2 bg-white/5 rounded-lg border border-white/10">`;
      html += `<span class="text-white text-sm font-medium">${this.escapeHtml(player.username)}</span>`;
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }

  private escapeHtml(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-join-private-lobby-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-join-private-lobby-modal": DioxusJoinPrivateLobbyModal;
  }
}

@customElement("dioxus-public-lobby")
export class DioxusPublicLobby extends LitElement {
  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  @state()
  isVisible = false;

  @state()
  public isLobbyHighlighted: boolean = false;

  private lobbies: GameInfo[] = [];
  private mapImages: Map<GameID, string> = new Map();
  private joiningDotIndex: number = 0;
  private joiningInterval: number | null = null;
  private currLobby: GameInfo | null = null;
  private isButtonDebounced: boolean = false;
  private debounceDelay: number = 150;
  private lobbyIDToStart = new Map<GameID, number>();
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private runtimeUnsubscribe?: () => void;

  private lobbySocket = new PublicLobbySocket((lobbies) =>
    this.handleLobbiesUpdate(lobbies),
  );

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
    this.lobbySocket.start();

    // Update timer display every second
    this.updateInterval = setInterval(() => {
      this.updateLobbyDisplay();
    }, 1000);
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    this.lobbySocket.stop();
    this.stopJoiningAnimation();
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    super.disconnectedCallback();
  }

  private getTranslations() {
    return {
      join: translateText("public_lobby.join"),
      started: translateText("public_lobby.started"),
      startingGame: translateText("public_lobby.starting_game"),
      waitingForPlayers: translateText("public_lobby.waiting_for_players"),
      ffa: translateText("game_mode.ffa"),
      teams: translateText("game_mode.teams"),
      teamsHvn: translateText("public_lobby.teams_hvn"),
      playersPerTeam: translateText("public_lobby.players_per_team"),
    };
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
    this.updateLobbyDisplay();
  }

  private async loadMapImage(gameID: GameID, gameMap: string) {
    try {
      const mapType = gameMap as GameMapType;
      const data = terrainMapFileLoader.getMapData(mapType);
      this.mapImages.set(gameID, await data.webpPath());
      this.updateLobbyDisplay();
    } catch (error) {
      console.error("Failed to load map image:", error);
    }
  }

  private updateLobbyDisplay() {
    if (!this.isLaunched || this.lobbies.length === 0) {
      if (this.isLaunched) {
        this.sendLobbyData(null);
      }
      return;
    }

    const lobby = this.lobbies[0];
    if (!lobby?.gameConfig) {
      this.sendLobbyData(null);
      return;
    }

    const start = this.lobbyIDToStart.get(lobby.gameID) ?? 0;
    const timeRemaining = Math.max(
      0,
      Math.floor((start - Date.now()) / 1000),
    );
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

    const modifierLabels = this.getModifierLabels(
      lobby.gameConfig.publicGameModifiers,
    );

    const mapImageSrc = this.mapImages.get(lobby.gameID) ?? "";
    const mapName = translateText(
      `map.${lobby.gameConfig.gameMap.toLowerCase().replace(/[\s.]+/g, "")}`,
    );

    this.sendLobbyData({
      gameId: lobby.gameID,
      mapName,
      mapImageUrl: mapImageSrc,
      modeLabel: fullModeLabel,
      timeDisplay,
      timeRemaining,
      numClients: lobby.numClients ?? 0,
      maxPlayers,
      modifierLabels,
      isVisible: true,
    });

    // Update joining state
    const isStarting = timeRemaining <= 2;
    this.sendJoiningState({
      isJoining: this.currLobby !== null,
      isHighlighted: this.isLobbyHighlighted,
      dotIndex: this.joiningDotIndex,
      isStarting,
    });
  }

  private sendLobbyData(data: Record<string, unknown> | null) {
    if (!this.isLaunched) return;
    dispatchLobbyRuntimeSnapshot(UI_RUNTIME_SNAPSHOTS.uiSnapshotLobbyPublicData, {
      data:
        data ??
        ({
          gameId: "",
          mapName: "",
          mapImageUrl: "",
          modeLabel: "",
          timeDisplay: "",
          timeRemaining: 0,
          numClients: 0,
          maxPlayers: 0,
          modifierLabels: [],
          isVisible: false,
        } satisfies Record<string, unknown>),
    });
  }

  private sendJoiningState(state: Record<string, unknown>) {
    if (!this.isLaunched) return;
    dispatchLobbyRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotLobbyPublicJoining,
      { state },
    );
  }

  leaveLobby() {
    this.isLobbyHighlighted = false;
    this.currLobby = null;
    this.stopJoiningAnimation();
    this.updateLobbyDisplay();
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
      this.updateLobbyDisplay();
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
      const maybeTranslated = translateText(teamKey, {
        team_count: teamTotal ?? 0,
      });
      if (maybeTranslated !== teamKey) {
        return { label: maybeTranslated, isFullLabel: true };
      }
    }

    if (teamTotal !== undefined && teamSize !== undefined) {
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
    if (publicGameModifiers.startingGold) {
      labels.push(translateText("public_game_modifier.starting_gold"));
    }
    return labels;
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchLobbyRuntimeAction(UI_RUNTIME_ACTIONS.uiPublicLobbyLaunch, {
        translations,
      });

      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [UI_RUNTIME_EVENTS.uiLobbyPublicClick],
        (event) => {
          const payload = parseUiRuntimePayload(event.payload);
          const gameId = parseUiRuntimeString(payload.gameId).trim();
          if (gameId) {
            this.handleLobbyClick(gameId);
          }
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusPublicLobby] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private handleLobbyClick(gameId: string) {
    if (this.isButtonDebounced) return;

    this.isButtonDebounced = true;
    setTimeout(() => {
      this.isButtonDebounced = false;
    }, this.debounceDelay);

    const lobby = this.lobbies.find((l) => l.gameID === gameId);
    if (!lobby) return;

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

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-public-lobby-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-public-lobby": DioxusPublicLobby;
  }
}
