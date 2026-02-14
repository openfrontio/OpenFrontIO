/**
 * In-game modal bridges consolidated in one module.
 */

import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../core/EventBus";
import { GameEnv } from "../core/configuration/Config";
import { GameType, PlayerType } from "../core/game/Game";
import { GameView, PlayerView } from "../core/game/GameView";
import kickIcon from "/images/ExitIconWhite.svg?url";
import shieldIcon from "/images/ShieldIconWhite.svg?url";
import quickChatData from "../../resources/QuickChat.json" with { type: "json" };
import { Layer } from "./graphics/layers/Layer";
import { UIState } from "./graphics/UIState";
import { MultiTabDetector } from "./MultiTabDetector";
import {
  ensureUiSessionRuntimeStarted,
  reportUiModalState,
  requestUiModalClose,
  UI_SESSION_RUNTIME_EVENTS,
  type UiSessionModalCloseDetail,
} from "./runtime/UiSessionRuntime";
import {
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendKickPlayerIntentEvent,
  SendQuickChatEvent,
} from "./Transport";
import { translateText } from "./Utils";
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

function dispatchInGameRuntimeAction(
  actionType: string,
  payload: Record<string, unknown> = {},
): void {
  if (!dispatchUiAction({ type: actionType, payload })) {
    console.warn(
      "[InGameModalBridges] Failed to dispatch runtime action:",
      actionType,
    );
  }
}

function dispatchInGameRuntimeSnapshot(
  snapshotType: string,
  payload: Record<string, unknown>,
): void {
  if (!dispatchUiSnapshot({ type: snapshotType, payload })) {
    console.warn(
      "[InGameModalBridges] Failed to dispatch runtime snapshot:",
      snapshotType,
    );
  }
}

/** Modal state passed to Dioxus */
export interface DioxusChatModalState {
  isOpen: boolean;
  selectedCategory: string | null;
  selectedPhraseText: string | null;
  selectedPhraseTemplate: string | null;
  selectedQuickChatKey: string | null;
  previewText: string | null;
  requiresPlayerSelection: boolean;
  playerSearchQuery: string;
  selectedPlayerId: string | null;
}

/** Player info passed to Dioxus */
export interface DioxusChatPlayer {
  id: string;
  name: string;
}

/** Quick chat phrase */
export interface DioxusQuickChatPhrase {
  key: string;
  requiresPlayer: boolean;
}

/** Quick chat phrases by category */
export type DioxusQuickChatPhrases = Record<string, DioxusQuickChatPhrase[]>;

/** Translations passed to Dioxus */
export interface DioxusChatModalTranslations {
  title: string;
  category: string;
  phrase: string;
  player: string;
  search: string;
  build: string;
  send: string;
  close: string;
  catHelp: string;
  catAttack: string;
  catDefend: string;
  catGreet: string;
  catMisc: string;
  catWarnings: string;
}

/** Event detail from Dioxus when send is clicked */
export interface DioxusChatSendEvent {
  quickChatKey: string;
  selectedPlayerId: string | null;
  message: string;
}

/** Event to show/hide the chat modal */
export class ShowChatModalEvent {
  constructor(
    public readonly isVisible: boolean,
    public readonly sender: PlayerView | null = null,
    public readonly recipient: PlayerView | null = null,
    public readonly categoryId: string | null = null,
    public readonly phraseKey: string | null = null,
  ) {}
}

@customElement("dioxus-chat-modal")
export class DioxusChatModal extends LitElement implements Layer {
  public eventBus: EventBus;
  public game: GameView | null = null;

  @state()
  private isVisible: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  private sender: PlayerView | null = null;
  private recipient: PlayerView | null = null;
  private preselectedCategoryId: string | null = null;
  private preselectedPhraseKey: string | null = null;
  private isWasmInitialized: boolean = false;
  private lastPlayersSignature: string | null = null;
  private runtimeUnsubscribe?: () => void;

  // Cached quick chat data
  private quickChatPhrases: DioxusQuickChatPhrases = quickChatData;

  createRenderRoot() {
    return this;
  }

  init() {
    if (!this.eventBus) {
      console.error("[DioxusChatModal] eventBus not set");
      return;
    }

    // Listen for show/hide events
    this.eventBus.on(ShowChatModalEvent, (event) => {
      if (event.isVisible) {
        this.sender = event.sender;
        this.recipient = event.recipient;
        this.preselectedCategoryId = event.categoryId;
        this.preselectedPhraseKey = event.phraseKey;
        this.openModal();
      } else {
        this.closeModal();
      }
    });
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
      [
        UI_RUNTIME_EVENTS.uiInGameChatModalCloseRequest,
        UI_RUNTIME_EVENTS.uiInGameChatModalSend,
      ],
      (event) => {
        if (event.type === UI_RUNTIME_EVENTS.uiInGameChatModalCloseRequest) {
          requestUiModalClose("chat", "component");
          return;
        }

        const detail = parseUiRuntimePayload(event.payload);
        const quickChatKey = parseUiRuntimeString(detail.quickChatKey).trim();
        const message = parseUiRuntimeString(detail.message);
        const selectedPlayerRaw = detail.selectedPlayerId;
        const selectedPlayerId =
          typeof selectedPlayerRaw === "string" && selectedPlayerRaw.trim()
            ? selectedPlayerRaw
            : null;
        if (!quickChatKey) {
          return;
        }
        this.handleSendChat({
          quickChatKey,
          selectedPlayerId,
          message,
        });
      },
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState("chat", false);
    }
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleSessionModalClose = (event: CustomEvent<UiSessionModalCloseDetail>) => {
    if (!this.isVisible || event.detail?.modal !== "chat") {
      return;
    }
    this.closeModal();
  };

  private handleSendChat(detail: DioxusChatSendEvent) {
    // Emit the SendQuickChatEvent to the game
    if (this.recipient) {
      this.eventBus.emit(
        new SendQuickChatEvent(
          this.recipient,
          detail.quickChatKey,
          detail.selectedPlayerId ?? undefined,
        ),
      );
    }

    this.closeModal();
  }

  private async openModal() {
    await ensureUiSessionRuntimeStarted();
    this.isVisible = true;
    reportUiModalState("chat", true);
    this.requestUpdate();

    // Wait for next render then launch Dioxus
    await this.updateComplete;
    await this.launchDioxusComponent();
  }

  private closeModal() {
    reportUiModalState("chat", false);
    this.isVisible = false;
    this.requestUpdate();

    if (this.isWasmInitialized) {
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameChatModalClose);
    }
  }

  private getModalState(): DioxusChatModalState {
    return {
      isOpen: true,
      selectedCategory: this.preselectedCategoryId,
      selectedPhraseText: null,
      selectedPhraseTemplate: null,
      selectedQuickChatKey: null,
      previewText: null,
      requiresPlayerSelection: false,
      playerSearchQuery: "",
      selectedPlayerId: null,
    };
  }

  private getPlayers(): DioxusChatPlayer[] {
    if (!this.game) {
      return [];
    }

    return this.buildDioxusPlayers(this.game.players());
  }

  private buildDioxusPlayers(players: PlayerView[]): DioxusChatPlayer[] {
    return players
      .filter((player) => player.isAlive() && player.data.playerType !== PlayerType.Bot)
      .map((player) => ({
        id: String(player.id()),
        name: player.name(),
      }));
  }

  private computePlayersSignature(players: DioxusChatPlayer[]): string {
    return players.map((player) => `${player.id}:${player.name}`).join("|");
  }

  private getTranslations(): DioxusChatModalTranslations {
    return {
      title: translateText("chat.title"),
      category: translateText("chat.category"),
      phrase: translateText("chat.phrase"),
      player: translateText("chat.player"),
      search: translateText("chat.search"),
      build: translateText("chat.build"),
      send: translateText("chat.send"),
      close: translateText("common.close"),
      catHelp: translateText("chat.cat.help"),
      catAttack: translateText("chat.cat.attack"),
      catDefend: translateText("chat.cat.defend"),
      catGreet: translateText("chat.cat.greet"),
      catMisc: translateText("chat.cat.misc"),
      catWarnings: translateText("chat.cat.warnings"),
    };
  }

  private getPhraseTranslations(): Record<string, string> {
    // Build a map of all phrase translation keys
    const translations: Record<string, string> = {};

    for (const [category, phrases] of Object.entries(this.quickChatPhrases)) {
      for (const phrase of phrases) {
        const key = `chat.${category}.${phrase.key}`;
        translations[key] = translateText(key);
      }
    }

    return translations;
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();
      this.isWasmInitialized = true;

      this.loading = false;
      this.requestUpdate();

      // Wait for the mount point to be rendered
      await this.updateComplete;

      const state = this.getModalState();
      const players = this.getPlayers();
      const translations = this.getTranslations();
      const phraseTranslations = this.getPhraseTranslations();

      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameChatModalLaunch, {
        state,
        players,
        quickChatPhrases: this.quickChatPhrases,
        translations,
        phraseTranslations,
      });

      // If we have a preselected category/phrase, trigger it after launch
      if (this.preselectedCategoryId && this.preselectedPhraseKey) {
        const selectedCategoryId = this.preselectedCategoryId;
        const selectedPhraseKey = this.preselectedPhraseKey;
        setTimeout(() => {
          dispatchInGameRuntimeAction(
            UI_RUNTIME_ACTIONS.uiInGameChatModalOpenWithSelection,
            {
              categoryId: selectedCategoryId,
              phraseKey: selectedPhraseKey,
            },
          );
        }, 100);
      }
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusChatModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  /**
   * Update the players list from the game
   * Call this when the game's player list changes
   */
  updatePlayers(players: PlayerView[]) {
    if (!this.isWasmInitialized) {
      return;
    }

    const dioxusPlayers = this.buildDioxusPlayers(players);
    const signature = this.computePlayersSignature(dioxusPlayers);
    if (signature === this.lastPlayersSignature) {
      return;
    }
    this.lastPlayersSignature = signature;

    dispatchInGameRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameChatModalPlayers,
      {
        players: dioxusPlayers,
      },
    );
  }

  private handleBackdropClick = (event: MouseEvent) => {
    // Only close if clicking on the backdrop itself, not its children
    if (event.target === event.currentTarget) {
      this.closeModal();
    }
  };

  tick() {
    if (!this.isVisible || !this.game) {
      return;
    }
    this.updatePlayers(this.game.players());
  }

  render() {
    if (!this.isVisible) {
      return null;
    }

    if (this.loading) {
      return html`
        <div
          class="fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center"
        >
          <div class="text-white">Loading...</div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div
          class="fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center"
        >
          <div class="bg-zinc-900 p-4 rounded-2xl text-zinc-200">
            <div class="text-red-400">Error: ${this.error}</div>
            <button
              class="mt-4 px-4 py-2 bg-zinc-700 text-white rounded-lg"
              @click=${this.closeModal}
            >
              ${translateText("common.close")}
            </button>
          </div>
        </div>
      `;
    }

    // Render the backdrop and mount point for Dioxus
    return html`
      <div
        class="fixed inset-0 bg-black/60 rounded-2xl z-1200 flex items-center justify-center p-4"
        @click=${this.handleBackdropClick}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div id="dioxus-chat-modal-root"></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-chat-modal": DioxusChatModal;
  }
}

/** Modal state passed to Dioxus */
export interface DioxusPlayerModerationState {
  isOpen: boolean;
  alreadyKicked: boolean;
}

/** Target player info passed to Dioxus */
export interface DioxusTargetPlayer {
  id: string;
  name: string;
  playerType: string;
  clientId: string | null;
  isLobbyCreator: boolean;
}

/** Current player info passed to Dioxus */
export interface DioxusMyPlayer {
  id: string;
  isLobbyCreator: boolean;
}

/** Translations passed to Dioxus */
export interface DioxusPlayerModerationTranslations {
  moderation: string;
  kick: string;
  kicked: string;
  close: string;
  kickConfirm: string;
}

/** Event detail from Dioxus when kick is clicked */
export interface DioxusPlayerModerationKickEvent {
  playerId: string;
  playerName: string;
  confirmMessage: string;
}

/** Event to show/hide the player moderation modal */
export class ShowPlayerModerationModalEvent {
  constructor(
    public readonly isVisible: boolean,
    public readonly myPlayer: PlayerView | null,
    public readonly targetPlayer: PlayerView | null,
    public readonly alreadyKicked: boolean = false,
  ) {}
}

@customElement("dioxus-player-moderation-modal")
export class DioxusPlayerModerationModal extends LitElement implements Layer {
  public eventBus: EventBus;

  @state()
  private isVisible: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  private myPlayer: PlayerView | null = null;
  private targetPlayer: PlayerView | null = null;
  private alreadyKicked: boolean = false;
  private isWasmInitialized: boolean = false;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  init() {
    if (!this.eventBus) {
      console.error("[DioxusPlayerModerationModal] eventBus not set");
      return;
    }

    // Listen for show/hide events
    this.eventBus.on(ShowPlayerModerationModalEvent, (event) => {
      if (event.isVisible) {
        this.myPlayer = event.myPlayer;
        this.targetPlayer = event.targetPlayer;
        this.alreadyKicked = event.alreadyKicked;
        this.openModal();
      } else {
        this.closeModal();
      }
    });
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
      [
        UI_RUNTIME_EVENTS.uiInGamePlayerModerationCloseRequest,
        UI_RUNTIME_EVENTS.uiInGamePlayerModerationKick,
      ],
      (event) => {
        if (
          event.type === UI_RUNTIME_EVENTS.uiInGamePlayerModerationCloseRequest
        ) {
          requestUiModalClose("player-moderation", "component");
          return;
        }

        const detail = parseUiRuntimePayload(event.payload);
        const playerId = parseUiRuntimeString(detail.playerId).trim();
        const playerName = parseUiRuntimeString(detail.playerName).trim();
        const confirmMessage = parseUiRuntimeString(
          detail.confirmMessage,
        ).trim();
        if (!playerId || !playerName || !confirmMessage) {
          return;
        }
        this.handleKick({
          playerId,
          playerName,
          confirmMessage,
        });
      },
    );
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState("player-moderation", false);
    }
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleSessionModalClose = (event: CustomEvent<UiSessionModalCloseDetail>) => {
    if (!this.isVisible || event.detail?.modal !== "player-moderation") {
      return;
    }
    this.closeModal();
  };

  private handleKick(detail: DioxusPlayerModerationKickEvent) {
    const my = this.myPlayer;
    const target = this.targetPlayer;
    if (!my || !target) return;
    if (!this.canKick(my, target) || this.alreadyKicked) return;
    if (!this.eventBus) return;

    // Show confirmation dialog
    const confirmed = confirm(detail.confirmMessage);
    if (!confirmed) return;

    // Emit kick event
    const targetClientID = target.clientID();
    if (!targetClientID || targetClientID.length === 0) return;

    this.eventBus.emit(new SendKickPlayerIntentEvent(targetClientID));

    // Dispatch kicked event
    this.dispatchEvent(
      new CustomEvent("kicked", { detail: { playerId: String(target.id()) } }),
    );

    this.closeModal();
  }

  private canKick(my: PlayerView, other: PlayerView): boolean {
    return (
      my.isLobbyCreator() &&
      other !== my &&
      other.type() === PlayerType.Human &&
      !!other.clientID()
    );
  }

  private async openModal() {
    await ensureUiSessionRuntimeStarted();
    this.isVisible = true;
    reportUiModalState("player-moderation", true);
    this.requestUpdate();

    // Wait for next render then launch Dioxus
    await this.updateComplete;
    await this.launchDioxusComponent();
  }

  private closeModal() {
    reportUiModalState("player-moderation", false);
    this.isVisible = false;
    this.requestUpdate();

    if (this.isWasmInitialized) {
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGamePlayerModerationModalClose,
      );
    }
  }

  private getModalState(): DioxusPlayerModerationState {
    return {
      isOpen: true,
      alreadyKicked: this.alreadyKicked,
    };
  }

  private getMyPlayer(): DioxusMyPlayer | null {
    const my = this.myPlayer;
    if (!my) return null;

    return {
      id: String(my.id()),
      isLobbyCreator: my.isLobbyCreator(),
    };
  }

  private getTargetPlayer(): DioxusTargetPlayer | null {
    const target = this.targetPlayer;
    if (!target) return null;

    return {
      id: String(target.id()),
      name: target.name(),
      playerType: target.type(),
      clientId: target.clientID(),
      isLobbyCreator: target.isLobbyCreator(),
    };
  }

  private getTranslations(): DioxusPlayerModerationTranslations {
    const target = this.targetPlayer;
    const playerName = target?.name() ?? "";

    return {
      moderation: translateText("player_panel.moderation"),
      kick: translateText("player_panel.kick"),
      kicked: translateText("player_panel.kicked"),
      close: translateText("common.close"),
      kickConfirm: translateText("player_panel.kick_confirm", { name: playerName }),
    };
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();
      this.isWasmInitialized = true;

      this.loading = false;
      this.requestUpdate();

      // Wait for the mount point to be rendered
      await this.updateComplete;

      const state = this.getModalState();
      const myPlayer = this.getMyPlayer();
      const targetPlayer = this.getTargetPlayer();
      const translations = this.getTranslations();

      if (!myPlayer || !targetPlayer) {
        console.error("[DioxusPlayerModerationModal] Missing player data");
        this.error = "Missing player data";
        this.requestUpdate();
        return;
      }

      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGamePlayerModerationModalLaunch,
        {
          state,
          myPlayer,
          targetPlayer,
          translations,
          kickIcon,
          shieldIcon,
        },
      );
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusPlayerModerationModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private handleBackdropClick = (event: MouseEvent) => {
    // Only close if clicking on the backdrop itself, not its children
    if (event.target === event.currentTarget) {
      this.closeModal();
    }
  };

  render() {
    if (!this.isVisible) {
      return null;
    }

    if (this.loading) {
      return html`
        <div
          class="fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center"
        >
          <div class="text-white">Loading...</div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div
          class="fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center"
        >
          <div class="bg-zinc-900 p-4 rounded-2xl text-zinc-200">
            <div class="text-red-400">Error: ${this.error}</div>
            <button
              class="mt-4 px-4 py-2 bg-zinc-700 text-white rounded-lg"
              @click=${this.closeModal}
            >
              ${translateText("common.close")}
            </button>
          </div>
        </div>
      `;
    }

    // Render the backdrop and mount point for Dioxus
    return html`
      <div
        class="fixed inset-0 bg-black/60 rounded-2xl z-1200 flex items-center justify-center p-4"
        @click=${this.handleBackdropClick}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div id="dioxus-player-moderation-modal-root"></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-player-moderation-modal": DioxusPlayerModerationModal;
  }
}

export interface SendResourceTranslations {
  titleTroops: string;
  titleGold: string;
  available: string;
  availableTooltipTroops: string;
  availableTooltipGold: string;
  presetMax: string;
  ariaSliderTroops: string;
  ariaSliderGold: string;
  summarySend: string;
  summaryKeep: string;
  closeLabel: string;
  cancel: string;
  send: string;
  capLabel: string;
  capTooltip: string;
  capacityNote: string;
  targetDeadTitle: string;
  targetDeadNote: string;
}

const IN_GAME_MODAL_IDS = {
  sendResource: "send-resource",
} as const;

@customElement("dioxus-send-resource-modal")
export class DioxusSendResourceModal extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;

  @state() private isLaunched = false;
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() isVisible = false;

  private mode: "troops" | "gold" = "troops";
  private myPlayer: PlayerView | null = null;
  private target: PlayerView | null = null;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState(IN_GAME_MODAL_IDS.sendResource, false);
    }
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleSessionModalClose = (
    event: CustomEvent<UiSessionModalCloseDetail>,
  ) => {
    if (
      !this.isVisible ||
      event.detail?.modal !== IN_GAME_MODAL_IDS.sendResource
    ) {
      return;
    }

    this.closeModal(true);
  };

  private closeModal(syncWasmHide: boolean): void {
    reportUiModalState(IN_GAME_MODAL_IDS.sendResource, false);
    this.isVisible = false;
    this.requestUpdate();

    if (!syncWasmHide || !this.isLaunched) {
      return;
    }

    dispatchInGameRuntimeAction(
      UI_RUNTIME_ACTIONS.uiInGameSendResourceModalHide,
    );
  }

  private getTranslations(): SendResourceTranslations {
    return {
      titleTroops: translateText("send_troops_modal.title_with_name"),
      titleGold: translateText("send_gold_modal.title_with_name"),
      available: translateText("common.available"),
      availableTooltipTroops: translateText(
        "send_troops_modal.available_tooltip",
      ),
      availableTooltipGold: translateText("send_gold_modal.available_tooltip"),
      presetMax: translateText("common.preset_max"),
      ariaSliderTroops: translateText("send_troops_modal.aria_slider"),
      ariaSliderGold: translateText("send_gold_modal.aria_slider"),
      summarySend: translateText("common.summary_send"),
      summaryKeep: translateText("common.summary_keep"),
      closeLabel: translateText("common.close"),
      cancel: translateText("common.cancel"),
      send: translateText("common.send"),
      capLabel: translateText("common.cap_label"),
      capTooltip: translateText("common.cap_tooltip"),
      capacityNote: translateText("send_troops_modal.capacity_note"),
      targetDeadTitle: translateText("common.target_dead"),
      targetDeadNote: translateText("common.target_dead_note"),
    };
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
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameSendResourceModalLaunch,
        { translations },
      );

      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [
          UI_RUNTIME_EVENTS.uiInGameSendResourceCloseRequest,
          UI_RUNTIME_EVENTS.uiInGameSendResourceConfirm,
        ],
        (event) => {
          if (event.type === UI_RUNTIME_EVENTS.uiInGameSendResourceCloseRequest) {
            requestUiModalClose(IN_GAME_MODAL_IDS.sendResource, "component");
            return;
          }

          const detail = parseUiRuntimePayload(event.payload);
          if (!this.eventBus || !this.myPlayer || !this.target) {
            return;
          }

          const amount = detail.amount;
          const mode = parseUiRuntimeString(detail.mode).trim();
          if (typeof amount !== "number" || amount <= 0) {
            return;
          }

          if (mode === "troops") {
            this.eventBus.emit(
              new SendDonateTroopsIntentEvent(this.target, amount),
            );
          } else if (mode === "gold") {
            this.eventBus.emit(
              new SendDonateGoldIntentEvent(
                this.target,
                BigInt(Math.floor(amount)),
              ),
            );
          } else {
            return;
          }

          requestUiModalClose(IN_GAME_MODAL_IDS.sendResource, "confirm");
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error =
        err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusSendResourceModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  async show(
    mode: "troops" | "gold",
    myPlayer: PlayerView,
    target: PlayerView,
    heading?: string,
  ) {
    await ensureUiSessionRuntimeStarted();
    this.isVisible = true;
    reportUiModalState(IN_GAME_MODAL_IDS.sendResource, true);
    this.mode = mode;
    this.myPlayer = myPlayer;
    this.target = target;

    if (this.isLaunched) {
      const total =
        mode === "troops"
          ? Number(myPlayer.troops())
          : Number(myPlayer.gold());

      let capacityLeft: number | null = null;
      if (mode === "troops" && this.game) {
        const current = Number(target.troops());
        const max = Number(this.game.config().maxTroops(target));
        capacityLeft = Math.max(0, max - current);
      }

      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameSendResourceModalShow,
        {
          state: {
            mode,
            total,
            targetName: target.name(),
            targetAlive: target.isAlive(),
            senderAlive: myPlayer.isAlive(),
            capacityLeft,
            heading: heading ?? null,
          },
        },
      );
    }

    this.requestUpdate();
  }

  async hide() {
    this.closeModal(true);
  }

  init() {}

  tick() {
    if (!this.isVisible || !this.isLaunched || !this.myPlayer || !this.target) {
      return;
    }

    // Check if sender or target died
    if (!this.myPlayer.isAlive() || !this.target.isAlive()) {
      // Let the Dioxus component show the dead state
    }

    // Update totals
    const total =
      this.mode === "troops"
        ? Number(this.myPlayer.troops())
        : Number(this.myPlayer.gold());

    let capacityLeft = 0;
    let hasCapacity = false;
    if (this.mode === "troops" && this.game) {
      const current = Number(this.target.troops());
      const max = Number(this.game.config().maxTroops(this.target));
      capacityLeft = Math.max(0, max - current);
      hasCapacity = true;
    }

    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameSendResourceTotal,
        scope: "ingame",
        tick: this.game?.ticks(),
        payload: {
          total,
          mode: this.mode,
          capacityLeft,
          hasCapacity,
          targetAlive: this.target?.isAlive() ?? false,
          senderAlive: this.myPlayer?.isAlive() ?? false,
        },
      })
    ) {
      console.warn(
        "[DioxusSendResourceModal] Failed to dispatch runtime snapshot",
      );
    }
  }

  render() {
    if (this.loading) return html``;
    if (this.error) {
      return html`<div class="text-red-400 text-xs">Error: ${this.error}</div>`;
    }
    return html`
      <div
        id="dioxus-send-resource-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-send-resource-modal": DioxusSendResourceModal;
  }
}

export interface MultiTabTranslations {
  warning: string;
  detected: string;
  pleaseWait: string;
  seconds: string;
  explanation: string;
}

@customElement("dioxus-multi-tab-modal")
export class DioxusMultiTabModal extends LitElement implements Layer {
  public game: GameView;

  private detector: MultiTabDetector;

  @property({ type: Number }) duration: number = 5000;
  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  @state()
  isVisible = false;

  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Auto-launch the Dioxus component when connected
    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  tick() {
    if (
      this.game?.inSpawnPhase() ||
      this.game?.config().gameConfig().gameType === GameType.Singleplayer ||
      this.game?.config().serverConfig().env() === GameEnv.Dev
    ) {
      return;
    }
    if (!this.detector) {
      this.detector = new MultiTabDetector();
      this.detector.startMonitoring((duration: number) => {
        this.show(duration);
      });
    }
  }

  init() {
    // Initialize fake IP and fingerprint in Rust component
    // These are generated internally by the Dioxus component
  }

  private getTranslations(): MultiTabTranslations {
    return {
      warning: translateText("multi_tab.warning"),
      detected: translateText("multi_tab.detected"),
      pleaseWait: translateText("multi_tab.please_wait"),
      seconds: translateText("multi_tab.seconds"),
      explanation: translateText("multi_tab.explanation"),
    };
  }

  private async launchDioxusComponent() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      // Load WASM module via centralized loader
      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      // Wait for mount point to be rendered
      await this.updateComplete;

      const translations = this.getTranslations();
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameMultiTabModalLaunch,
        { translations },
      );

      this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
        [UI_RUNTIME_EVENTS.uiInGameMultiTabPenaltyComplete],
        () => {
          this.dispatchEvent(
            new CustomEvent("penalty-complete", {
              bubbles: true,
              composed: true,
            }),
          );
        },
      );

      // Give Dioxus time to mount and store the signal before allowing updates
      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusMultiTabModal] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  async show(duration: number = 5000) {
    this.isVisible = true;
    if (this.isLaunched) {
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameMultiTabModalShow,
        {
          durationMs: duration,
        },
      );
    }
    this.requestUpdate();
  }

  async hide() {
    this.isVisible = false;
    if (this.isLaunched) {
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameMultiTabModalHide,
      );
    }
    this.requestUpdate();
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

    // Render mount point for Dioxus
    return html`
      <div
        id="dioxus-multi-tab-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-multi-tab-modal": DioxusMultiTabModal;
  }
}
