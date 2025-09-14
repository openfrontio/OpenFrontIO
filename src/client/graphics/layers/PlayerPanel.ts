import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import chatIcon from "../../../../resources/images/ChatIconWhite.svg";
import donateGoldIcon from "../../../../resources/images/DonateGoldIconWhite.svg";
import donateTroopIcon from "../../../../resources/images/DonateTroopIconWhite.svg";
import emojiIcon from "../../../../resources/images/EmojiIconWhite.svg";
import targetIcon from "../../../../resources/images/TargetIconWhite.svg";
import traitorIcon from "../../../../resources/images/TraitorIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { AllPlayers, PlayerActions } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { flattenedEmojiTable } from "../../../core/Util";
import Countries from "../../data/countries.json";
import { CloseViewEvent, MouseUpEvent } from "../../InputHandler";
import {
  SendAllianceRequestIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendEmbargoIntentEvent,
  SendEmojiIntentEvent,
  SendTargetPlayerIntentEvent,
} from "../../Transport";
import {
  renderDuration,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";
import { UIState } from "../UIState";
import { ChatModal } from "./ChatModal";
import { EmojiTable } from "./EmojiTable";
import { Layer } from "./Layer";

@customElement("player-panel")
export class PlayerPanel extends LitElement implements Layer {
  public g: GameView;
  public eventBus: EventBus;
  public emojiTable: EmojiTable;
  public uiState: UIState;

  private actions: PlayerActions | null = null;
  private tile: TileRef | null = null;

  @state()
  public isVisible: boolean = false;

  @state()
  private allianceExpiryText: string | null = null;

  @state()
  private allianceExpirySeconds: number | null = null;

  public show(actions: PlayerActions, tile: TileRef) {
    this.actions = actions;
    this.tile = tile;
    this.isVisible = true;
    this.requestUpdate();
  }

  public hide() {
    this.isVisible = false;
    this.requestUpdate();
  }

  private handleClose(e: Event) {
    e.stopPropagation();
    this.hide();
  }

  private handleAllianceClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendAllianceRequestIntentEvent(myPlayer, other));
    this.hide();
  }

  private handleBreakAllianceClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendBreakAllianceIntentEvent(myPlayer, other));
    this.hide();
  }

  private handleDonateTroopClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(
      new SendDonateTroopsIntentEvent(
        other,
        myPlayer.troops() * this.uiState.attackRatio,
      ),
    );
    this.hide();
  }

  private handleDonateGoldClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendDonateGoldIntentEvent(other, null));
    this.hide();
  }

  private handleEmbargoClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendEmbargoIntentEvent(other, "start"));
    this.hide();
  }

  private handleStopEmbargoClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendEmbargoIntentEvent(other, "stop"));
    this.hide();
  }

  private handleEmojiClick(e: Event, myPlayer: PlayerView, other: PlayerView) {
    e.stopPropagation();
    this.emojiTable.showTable((emoji: string) => {
      if (myPlayer === other) {
        this.eventBus.emit(
          new SendEmojiIntentEvent(
            AllPlayers,
            flattenedEmojiTable.indexOf(emoji),
          ),
        );
      } else {
        this.eventBus.emit(
          new SendEmojiIntentEvent(other, flattenedEmojiTable.indexOf(emoji)),
        );
      }
      this.emojiTable.hideTable();
      this.hide();
    });
  }

  private handleChat(e: Event, sender: PlayerView, other: PlayerView) {
    this.ctModal.open(sender, other);
    this.hide();
  }

  private handleTargetClick(e: Event, other: PlayerView) {
    e.stopPropagation();
    this.eventBus.emit(new SendTargetPlayerIntentEvent(other.id()));
    this.hide();
  }

  createRenderRoot() {
    return this;
  }

  private ctModal: ChatModal;

  initEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
    eventBus.on(CloseViewEvent, (e) => {
      if (!this.hidden) {
        this.hide();
      }
    });
  }

  init() {
    this.eventBus.on(MouseUpEvent, () => this.hide());
    this.eventBus.on(CloseViewEvent, (e) => {
      this.hide();
    });

    this.ctModal = document.querySelector("chat-modal") as ChatModal;
  }

  async tick() {
    if (this.isVisible && this.tile) {
      const myPlayer = this.g.myPlayer();
      if (myPlayer !== null && myPlayer.isAlive()) {
        this.actions = await myPlayer.actions(this.tile);
        if (this.actions?.interaction?.allianceExpiresAt !== undefined) {
          const expiresAt = this.actions.interaction.allianceExpiresAt;
          const remainingTicks = expiresAt - this.g.ticks();
          if (remainingTicks > 0) {
            const remainingSeconds = Math.max(
              0,
              Math.floor(remainingTicks / 10),
            ); // 10 ticks per second
            this.allianceExpirySeconds = remainingSeconds;
            this.allianceExpiryText = renderDuration(remainingSeconds);
          }
        } else {
          this.allianceExpirySeconds = null;
          this.allianceExpiryText = null;
        }
        this.requestUpdate();
      }
    }
  }

  private getExpiryColorClass(seconds: number | null): string {
    if (seconds === null) return "text-white";

    if (seconds <= 30) return "text-red-400"; // Last 30 seconds: Red
    if (seconds <= 60) return "text-yellow-400"; // Last 60 seconds: Yellow
    return "text-emerald-400"; // More than 60 seconds: Green
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }
    const btnBase =
      "w-full flex flex-col items-center rounded-lg px-2 py-2 border border-white/15 bg-white/5 shadow-sm transition-colors";
    const btnNormal = `${btnBase} text-zinc-200/80 hover:bg-white/10 hover:text-white`;
    const btnRed = `${btnBase} text-red-400 hover:bg-red-500/10 hover:text-red-300`;
    const btnGreen = `${btnBase} text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300`;
    const btnIndigo = `${btnBase} text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-300`;
    const iconSize = "h-5 w-5";
    const textSize = "text-[11px] font-medium";

    const myPlayer = this.g.myPlayer();
    if (myPlayer === null) return;
    if (this.tile === null) return;
    let other = this.g.owner(this.tile);
    if (!other.isPlayer()) {
      this.hide();
      console.warn("Tile is not owned by a player");
      return;
    }
    other = other as PlayerView;

    const canDonateGold = this.actions?.interaction?.canDonateGold;
    const canDonateTroops = this.actions?.interaction?.canDonateTroops;
    const canSendAllianceRequest =
      this.actions?.interaction?.canSendAllianceRequest;
    const canSendEmoji =
      other === myPlayer
        ? this.actions?.canSendEmojiAllPlayers
        : this.actions?.interaction?.canSendEmoji;
    const canBreakAlliance = this.actions?.interaction?.canBreakAlliance;
    const canTarget = this.actions?.interaction?.canTarget;
    const canEmbargo = this.actions?.interaction?.canEmbargo;

    //flag icon in the playerPanel
    const flagCode = other.cosmetics.flag;
    const country =
      typeof flagCode === "string"
        ? Countries.find((c) => c.code === flagCode)
        : undefined;
    const flagName = country?.name;

    return html`
      <div
        class="fixed inset-0 z-[1001] flex items-center justify-center overflow-auto
       pointer-events-none bg-black/60 backdrop-blur-sm"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
        @wheel=${(e: MouseEvent) => e.stopPropagation()}
      >
        <div
          class="pointer-events-auto max-h-[90vh] overflow-y-auto min-w-[240px] w-auto px-4 py-2"
        >
          <div
            class="relative mt-2 w-full rounded-xl border border-zinc-700
       bg-zinc-900 p-4 lg:p-5 shadow-2xl"
          >
            <!-- Close button -->
            <button
              @click=${this.handleClose}
              class="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center
       rounded-full bg-zinc-700 text-white shadow hover:bg-red-500 transition-colors"
            >
              ✕
            </button>

            <div class="flex flex-col gap-2 min-w-[240px]">
              <!-- Name section -->
              <div class="mb-1 flex items-center gap-3">
                ${country
                  ? html`<img
                      src="/flags/${flagCode}.svg"
                      alt=${flagName}
                      class="h-10 w-10 rounded-full object-cover"
                    />`
                  : ""}
                <h1 class="text-lg font-semibold truncate text-zinc-200">
                  ${other?.name()}
                </h1>
              </div>

              <!-- divider -->
              <div class="my-1 h-px bg-zinc-700/80"></div>

              <!-- Resources section -->
              <div class="mb-1 flex justify-between gap-2">
                <div
                  class="inline-flex items-center gap-0.5 rounded-full bg-zinc-800 px-2.5 py-1
                        text-sm font-medium text-zinc-200"
                >
                  <span>💰</span>
                  <span
                    translate="no"
                    class="inline-block w-[40px] text-right font-mono"
                  >
                    ${renderNumber(other.gold() || 0)}
                  </span>
                  <span class="opacity-90">
                    ${translateText("player_panel.gold")}
                  </span>
                </div>

                <div
                  class="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2.5 py-1
                        text-sm font-medium text-zinc-200"
                >
                  <span>🛡️</span>
                  <span
                    translate="no"
                    class="inline-block w-[40px] text-right font-mono"
                  >
                    ${renderTroops(other.troops() || 0)}
                  </span>
                  <span class="opacity-90">
                    ${translateText("player_panel.troops")}
                  </span>
                </div>
              </div>
              <div class="my-1 h-px bg-zinc-700/80"></div>

              <!-- Trust -->
              <div class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm">
                <div class="font-medium text-zinc-400">
                  ${translateText("player_panel.trust")}
                </div>
                <div class="flex items-center justify-end gap-2 font-medium">
                  ${other.isTraitor()
                    ? html`
                        <span class="text-red-400">
                          ${translateText("player_panel.traitor")}
                        </span>
                      `
                    : html`
                        <span class="text-emerald-400">
                          ${translateText("player_panel.stable")}
                        </span>
                      `}
                </div>
              </div>

              <!-- Betrayals -->
              <div class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm">
                <div class="font-medium text-zinc-400">
                  ${translateText("player_panel.betrayals")}
                </div>
                <div class="text-right font-medium text-zinc-200">
                  ${other.data.betrayals ?? 0}
                </div>
              </div>

              <!-- Embargo -->
              <div class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm">
                <div class="font-medium text-zinc-400">
                  ${translateText("player_panel.trading")}
                </div>
                <div class="flex items-center justify-end gap-2 font-medium">
                  ${other.hasEmbargoAgainst(myPlayer)
                    ? html`
                        <span class="text-red-400">
                          ${translateText("player_panel.stopped")}
                        </span>
                      `
                    : html`
                        <span class="text-emerald-400">
                          ${translateText("player_panel.active")}
                        </span>
                      `}
                </div>
              </div>

              <!-- Divider -->
              <div class="my-1 h-px bg-zinc-700/80"></div>

              <!-- Alliances -->
              <div class="text-sm">
                <div class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-1 mb-2">
                  <div class="font-medium text-zinc-400">
                    ${translateText("player_panel.alliances")}
                  </div>
                  <div class="text-right font-medium text-zinc-200">
                    (${other.allies().length})
                  </div>
                </div>

                <div class="mt-1 rounded-lg border border-zinc-700 bg-zinc-900">
                  <div
                    class="max-h-[72px] overflow-y-auto p-2 text-xs text-zinc-200"
                    translate="no"
                  >
                    ${other.allies().length > 0
                      ? other
                          .allies()
                          .map(
                            (p) => html`
                              <div class="truncate leading-6">${p.name()}</div>
                            `,
                          )
                      : html`<div class="py-2 text-zinc-400">
                          ${translateText("player_panel.none")}
                        </div>`}
                  </div>
                </div>
              </div>

              <!-- Alliance expiry -->
              ${this.allianceExpiryText !== null
                ? html`
                    <div
                      class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm"
                    >
                      <div class="font-medium text-zinc-400">
                        ${translateText("player_panel.alliance_time_remaining")}
                      </div>
                      <div class="text-right font-medium">
                        <span
                          class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${this.getExpiryColorClass(
                            this.allianceExpirySeconds,
                          )}"
                        >
                          ${this.allianceExpiryText}
                        </span>
                      </div>
                    </div>
                  `
                : ""}

              <div class="my-1 h-px bg-zinc-700/80"></div>

              <!-- Action buttons -->
              <div class="flex flex-col gap-2">
                <div class="grid auto-cols-fr grid-flow-col gap-1">
                  <!-- Chat -->
                  <button
                    @click=${(e: MouseEvent) =>
                      this.handleChat(e, myPlayer, other)}
                    class="${btnNormal}"
                    title="${translateText("player_panel.chat")}"
                  >
                    <img src=${chatIcon} alt="Chat" class="${iconSize}" />
                    <span class="${textSize}"
                      >${translateText("player_panel.chat")}</span
                    >
                  </button>

                  <!-- Emotes -->
                  ${canSendEmoji
                    ? html`
                        <button
                          @click=${(e: MouseEvent) =>
                            this.handleEmojiClick(e, myPlayer, other)}
                          class="${btnNormal}"
                          title="${translateText("player_panel.emotes")}"
                        >
                          <img
                            src=${emojiIcon}
                            alt="Emoji"
                            class="${iconSize}"
                          />
                          <span class="${textSize}"
                            >${translateText("player_panel.emotes")}</span
                          >
                        </button>
                      `
                    : ""}

                  <!-- Target -->
                  ${canTarget
                    ? html`
                        <button
                          @click=${(e: MouseEvent) =>
                            this.handleTargetClick(e, other)}
                          class="${btnNormal}"
                          title="${translateText("player_panel.target")}"
                        >
                          <img
                            src=${targetIcon}
                            alt="Target"
                            class="${iconSize}"
                          />
                          <span class="${textSize}"
                            >${translateText("player_panel.target")}</span
                          >
                        </button>
                      `
                    : ""}
                  <!-- Send Troops -->
                  ${canDonateTroops
                    ? html`
                        <button
                          @click=${(e: MouseEvent) =>
                            this.handleDonateTroopClick(e, myPlayer, other)}
                          class="${btnNormal}"
                          title="${translateText("player_panel.send_troops")}"
                        >
                          <img
                            src=${donateTroopIcon}
                            alt="Troops"
                            class="${iconSize}"
                          />
                          <span class="${textSize}"
                            >${translateText("player_panel.troops")}</span
                          >
                        </button>
                      `
                    : ""}

                  <!-- Send Gold -->
                  ${canDonateGold
                    ? html`
                        <button
                          @click=${(e: MouseEvent) =>
                            this.handleDonateGoldClick(e, myPlayer, other)}
                          class="${btnNormal}"
                          title="${translateText("player_panel.send_gold")}"
                        >
                          <img
                            src=${donateGoldIcon}
                            alt="Gold"
                            class="${iconSize}"
                          />
                          <span class="${textSize}"
                            >${translateText("player_panel.gold")}</span
                          >
                        </button>
                      `
                    : ""}
                </div>

                <div class="grid auto-cols-fr grid-flow-col gap-1">
                  <!-- Trade toggle -->
                  ${other !== myPlayer
                    ? canEmbargo
                      ? html`
                          <button
                            @click=${(e: MouseEvent) =>
                              this.handleEmbargoClick(e, myPlayer, other)}
                            class="${btnRed}"
                            title="${translateText("player_panel.stop_trade")}"
                          >
                            <img
                              src=${traitorIcon}
                              alt="Stop Trade"
                              class="${iconSize}"
                            />
                            <span class="${textSize}">
                              ${translateText("player_panel.stop_trade")}
                            </span>
                          </button>
                        `
                      : html`
                          <button
                            @click=${(e: MouseEvent) =>
                              this.handleStopEmbargoClick(e, myPlayer, other)}
                            class="${btnGreen}"
                            title=${translateText("player_panel.start_trade")}
                          >
                            <img
                              src=${allianceIcon}
                              alt="Start Trade"
                              class="${iconSize}"
                            />
                            <span class="${textSize}">
                              ${translateText("player_panel.start_trade")}
                            </span>
                          </button>
                        `
                    : ""}

                  <!-- Break Alliance -->
                  ${canBreakAlliance
                    ? html`
                        <button
                          @click=${(e: MouseEvent) =>
                            this.handleBreakAllianceClick(e, myPlayer, other)}
                          class="${btnRed}"
                          title="${translateText(
                            "player_panel.break_alliance",
                          )}"
                        >
                          <img
                            src=${traitorIcon}
                            alt="Break Alliance"
                            class="${iconSize}"
                          />
                          <span class="${textSize}"
                            >${translateText("player_panel.break")}</span
                          >
                        </button>
                      `
                    : ""}

                  <!-- Send Alliance Request -->
                  ${canSendAllianceRequest
                    ? html`
                        <button
                          @click=${(e: MouseEvent) =>
                            this.handleAllianceClick(e, myPlayer, other)}
                          class="${btnIndigo}"
                          title="${translateText("player_panel.alliance")}"
                        >
                          <img
                            src=${allianceIcon}
                            alt="Alliance"
                            class="${iconSize}"
                          />
                          <span class="${textSize}">
                            ${translateText("player_panel.send_alliance")}
                          </span>
                        </button>
                      `
                    : ""}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
