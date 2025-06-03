import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import chatIcon from "../../../../resources/images/ChatIconWhite.svg";
import donateGoldIcon from "../../../../resources/images/DonateGoldIconWhite.svg";
import donateTroopIcon from "../../../../resources/images/DonateTroopIconWhite.svg";
import emojiIcon from "../../../../resources/images/EmojiIconWhite.svg";
import targetIcon from "../../../../resources/images/TargetIconWhite.svg";
import traitorIcon from "../../../../resources/images/TraitorIconWhite.svg";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { AllPlayers, PlayerActions } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { flattenedEmojiTable } from "../../../core/Util";
import { MouseUpEvent } from "../../InputHandler";
import {
  SendAllianceRequestIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDonateGoldIntentEvent,
  SendDonateTroopsIntentEvent,
  SendEmbargoIntentEvent,
  SendEmojiIntentEvent,
  SendTargetPlayerIntentEvent,
} from "../../Transport";
import { renderNumber, renderTroops } from "../../Utils";
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
  private isVisible: boolean = false;

  @state()
  private allianceExpiryText: string | null = null;

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

  private ctModal;

  init() {
    this.eventBus.on(MouseUpEvent, (e: MouseEvent) => this.hide());

    this.ctModal = document.querySelector("chat-modal") as ChatModal;
  }

  async tick() {
    if (this.isVisible && this.tile) {
      const myPlayer = this.g.myPlayer();
      if (myPlayer !== null && myPlayer.isAlive()) {
        this.actions = await myPlayer.actions(this.tile);

        if (this.actions?.interaction?.allianceCreatedAtTick !== undefined) {
          const createdAt = this.actions.interaction.allianceCreatedAtTick;
          const durationTicks = this.g.config().allianceDuration();
          const expiryTick = createdAt + durationTicks;
          const remainingTicks = expiryTick - this.g.ticks();

          if (remainingTicks > 0) {
            const remainingSeconds = Math.max(
              0,
              Math.floor(remainingTicks / 10),
            ); // 10 ticks per second
            this.allianceExpiryText = this.formatDuration(remainingSeconds);
          }
        } else {
          this.allianceExpiryText = null;
        }
        this.requestUpdate();
      }
    }
  }

  private formatDuration(totalSeconds: number): string {
    if (totalSeconds <= 0) return "0s";
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    let time = "";
    if (minutes > 0) time += `${minutes}m `;
    time += `${seconds}s`;
    return time.trim();
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }
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

    const canDonate = this.actions?.interaction?.canDonate;
    const canSendAllianceRequest =
      this.actions?.interaction?.canSendAllianceRequest;
    const canSendEmoji =
      other === myPlayer
        ? this.actions?.canSendEmojiAllPlayers
        : this.actions?.interaction?.canSendEmoji;
    const canBreakAlliance = this.actions?.interaction?.canBreakAlliance;
    const canTarget = this.actions?.interaction?.canTarget;
    const canEmbargo = this.actions?.interaction?.canEmbargo;

    return html`
      <div
        class="fixed inset-0 flex items-center justify-center z-50 pointer-events-none overflow-auto"
        @contextmenu=${(e) => e.preventDefault()}
        @wheel=${(e) => e.stopPropagation()}
      >
        <div
          class="pointer-events-auto max-h-[90vh] overflow-y-auto min-w-[240px] w-auto px-4 py-2"
        >
          <div
            class="bg-opacity-60 bg-gray-900 p-1 lg:p-2 rounded-lg backdrop-blur-md relative w-full mt-2"
          >
            <!-- Close button -->
            <button
              @click=${this.handleClose}
              class="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center
                   bg-red-500 hover:bg-red-600 text-white rounded-full
                   text-sm font-bold transition-colors"
            >
              ✕
            </button>

            <div class="flex flex-col gap-2 min-w-[240px]">
              <!-- Name section -->
              <div class="flex items-center gap-1 lg:gap-2">
                <div
                  class="px-4 h-8 lg:h-10 flex items-center justify-center
                       bg-opacity-50 bg-gray-700 text-opacity-90 text-white
                       rounded text-sm lg:text-xl w-full"
                >
                  ${other?.name()}
                </div>
              </div>

              <!-- Resources section -->
              <div class="grid grid-cols-2 gap-2">
                <div class="flex flex-col gap-1">
                  <!-- Gold -->
                  <div class="text-white text-opacity-80 text-sm px-2">
                    ${translateText("player_panel.gold")}
                  </div>
                  <div
                    class="bg-opacity-50 bg-gray-700 rounded p-2 text-white"
                    translate="no"
                  >
                    ${renderNumber(other.gold() || 0)}
                  </div>
                </div>
                <div class="flex flex-col gap-1">
                  <!-- Troops -->
                  <div class="text-white text-opacity-80 text-sm px-2">
                    ${translateText("player_panel.troops")}
                  </div>
                  <div
                    class="bg-opacity-50 bg-gray-700 rounded p-2 text-white"
                    translate="no"
                  >
                    ${renderTroops(other.troops() || 0)}
                  </div>
                </div>
              </div>

              <!-- Attitude section -->
              <div class="flex flex-col gap-1">
                <div class="text-white text-opacity-80 text-sm px-2">
                  ${translateText("player_panel.traitor")}
                </div>
                <div class="bg-opacity-50 bg-gray-700 rounded p-2 text-white">
                  ${other.isTraitor()
                    ? translateText("player_panel.yes")
                    : translateText("player_panel.no")}
                </div>
              </div>

              <!-- Betrayals -->
              <div class="flex flex-col gap-1">
                <div class="text-white text-opacity-80 text-sm px-2">
                  ${translateText("player_panel.betrayals")}
                </div>
                <div class="bg-opacity-50 bg-gray-700 rounded p-2 text-white">
                  ${other.data.betrayals ?? 0}
                </div>
              </div>

              <!-- Embargo -->
              <div class="flex flex-col gap-1">
                <div class="text-white text-opacity-80 text-sm px-2">
                  ${translateText("player_panel.embargo")}
                </div>
                <div class="bg-opacity-50 bg-gray-700 rounded p-2 text-white">
                  ${other.hasEmbargoAgainst(myPlayer)
                    ? translateText("player_panel.yes")
                    : translateText("player_panel.no")}
                </div>
              </div>

              ${this.allianceExpiryText !== null
                ? html`
                    <div class="flex flex-col gap-1">
                      <div class="text-white text-opacity-80 text-sm px-2">
                        ${translateText("player_panel.alliance_time_remaining")}
                      </div>
                      <div
                        class="bg-opacity-50 bg-gray-700 rounded p-2 text-white"
                      >
                        ${this.allianceExpiryText}
                      </div>
                    </div>
                  `
                : ""}

              <!-- Action buttons -->
              <div class="flex justify-center gap-2">
                <button
                  @click=${(e) => this.handleChat(e, myPlayer, other)}
                  class="w-10 h-10 flex items-center justify-center
                           bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                           text-white rounded-lg transition-colors"
                >
                  <img src=${chatIcon} alt="Target" class="w-6 h-6" />
                </button>
                ${canTarget
                  ? html`<button
                      @click=${(e) => this.handleTargetClick(e, other)}
                      class="w-10 h-10 flex items-center justify-center
                           bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                           text-white rounded-lg transition-colors"
                    >
                      <img src=${targetIcon} alt="Target" class="w-6 h-6" />
                    </button>`
                  : ""}
                ${canBreakAlliance
                  ? html`<button
                      @click=${(e) =>
                        this.handleBreakAllianceClick(e, myPlayer, other)}
                      class="w-10 h-10 flex items-center justify-center
                           bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                           text-white rounded-lg transition-colors"
                    >
                      <img
                        src=${traitorIcon}
                        alt="Break Alliance"
                        class="w-6 h-6"
                      />
                    </button>`
                  : ""}
                ${canSendAllianceRequest
                  ? html`<button
                      @click=${(e) =>
                        this.handleAllianceClick(e, myPlayer, other)}
                      class="w-10 h-10 flex items-center justify-center
                           bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                           text-white rounded-lg transition-colors"
                    >
                      <img src=${allianceIcon} alt="Alliance" class="w-6 h-6" />
                    </button>`
                  : ""}
                ${canDonate
                  ? html`<button
                      @click=${(e) =>
                        this.handleDonateTroopClick(e, myPlayer, other)}
                      class="w-10 h-10 flex items-center justify-center
                           bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                           text-white rounded-lg transition-colors"
                    >
                      <img
                        src=${donateTroopIcon}
                        alt="Donate"
                        class="w-6 h-6"
                      />
                    </button>`
                  : ""}
                ${canDonate
                  ? html`<button
                      @click=${(e) =>
                        this.handleDonateGoldClick(e, myPlayer, other)}
                      class="w-10 h-10 flex items-center justify-center
                          bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                          text-white rounded-lg transition-colors"
                    >
                      <img src=${donateGoldIcon} alt="Donate" class="w-6 h-6" />
                    </button>`
                  : ""}
                ${canSendEmoji
                  ? html`<button
                      @click=${(e) => this.handleEmojiClick(e, myPlayer, other)}
                      class="w-10 h-10 flex items-center justify-center
                           bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                           text-white rounded-lg transition-colors"
                    >
                      <img src=${emojiIcon} alt="Emoji" class="w-6 h-6" />
                    </button>`
                  : ""}
              </div>
              ${canEmbargo && other !== myPlayer
                ? html`<button
                    @click=${(e) => this.handleEmbargoClick(e, myPlayer, other)}
                    class="w-100 h-10 flex items-center justify-center
                          bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                          text-white rounded-lg transition-colors"
                  >
                    ${translateText("player_panel.stop_trade")}
                  </button>`
                : ""}
              ${!canEmbargo && other !== myPlayer
                ? html`<button
                    @click=${(e) =>
                      this.handleStopEmbargoClick(e, myPlayer, other)}
                    class="w-100 h-10 flex items-center justify-center
                          bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                          text-white rounded-lg transition-colors"
                  >
                    ${translateText("player_panel.start_trade")}
                  </button>`
                : ""}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
