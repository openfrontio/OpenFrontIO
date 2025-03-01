import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import donateIcon from "../../../../resources/images/DonateIconWhite.svg";
import emojiIcon from "../../../../resources/images/EmojiIconWhite.svg";
import targetIcon from "../../../../resources/images/TargetIconWhite.svg";
import traitorIcon from "../../../../resources/images/TraitorIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { AllPlayers, PlayerActions } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { MouseUpEvent } from "../../InputHandler";
import {
  SendAllianceRequestIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDonateIntentEvent,
  SendEmojiIntentEvent,
  SendTargetPlayerIntentEvent,
} from "../../Transport";
import { renderNumber, renderTroops } from "../../Utils";
import { EmojiTable } from "./EmojiTable";
import { Layer } from "./Layer";

@customElement("player-panel")
export class PlayerPanel extends LitElement implements Layer {
  public g: GameView;
  public eventBus: EventBus;
  public emojiTable: EmojiTable;

  private actions: PlayerActions = null;
  private tile: TileRef = null;

  @state()
  private isVisible: boolean = false;

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

  private handleDonateClick(e: Event, myPlayer: PlayerView, other: PlayerView) {
    e.stopPropagation();
    this.eventBus.emit(new SendDonateIntentEvent(myPlayer, other, null));
    this.hide();
  }

  private handleEmojiClick(e: Event, myPlayer: PlayerView, other: PlayerView) {
    e.stopPropagation();
    this.emojiTable.showTable((emoji: string) => {
      if (myPlayer == other) {
        this.eventBus.emit(new SendEmojiIntentEvent(AllPlayers, emoji));
      } else {
        this.eventBus.emit(new SendEmojiIntentEvent(other, emoji));
      }
      this.emojiTable.hideTable();
      this.hide();
    });
  }

  private handleTargetClick(e: Event, other: PlayerView) {
    e.stopPropagation();
    this.eventBus.emit(new SendTargetPlayerIntentEvent(other.id()));
    this.hide();
  }

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(MouseUpEvent, (e: MouseEvent) => this.hide());
  }

  tick() {
    this.requestUpdate();
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }
    const myPlayer = this.g.myPlayer();
    if (myPlayer == null) {
      return;
    }

    let other = this.g.owner(this.tile);
    if (!other.isPlayer()) {
      throw new Error("Tile is not owned by a player");
    }
    other = other as PlayerView;

    const canDonate = this.actions.interaction?.canDonate;
    const canSendAllianceRequest =
      this.actions.interaction?.canSendAllianceRequest;
    const canSendEmoji =
      other == myPlayer
        ? this.actions.canSendEmojiAllPlayers
        : this.actions.interaction?.canSendEmoji;
    const canBreakAlliance = this.actions.interaction?.canBreakAlliance;
    const canTarget = this.actions.interaction?.canTarget;

    return html`
      <div
        class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <div
          class="bg-opacity-60 bg-gray-900 p-1 lg:p-2 rounded-lg backdrop-blur-md relative"
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
                <div class="text-white text-opacity-80 text-sm px-2">Gold</div>
                <div class="bg-opacity-50 bg-gray-700 rounded p-2 text-white">
                  ${renderNumber(other.gold() || 0)}
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <!-- Troops -->
                <div class="text-white text-opacity-80 text-sm px-2">
                  Troops
                </div>
                <div class="bg-opacity-50 bg-gray-700 rounded p-2 text-white">
                  ${renderTroops(other.troops() || 0)}
                </div>
              </div>
            </div>

            <!-- Attitude section -->
            <div class="flex flex-col gap-1">
              <div class="text-white text-opacity-80 text-sm px-2">Traitor</div>
              <div class="bg-opacity-50 bg-gray-700 rounded p-2 text-white">
                ${other.isTraitor() ? "Yes" : "No"}
              </div>
            </div>

            <!-- Action buttons -->
            <div class="flex justify-center gap-2">
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
                    @click=${(e) => this.handleDonateClick(e, myPlayer, other)}
                    class="w-10 h-10 flex items-center justify-center 
                           bg-opacity-50 bg-gray-700 hover:bg-opacity-70 
                           text-white rounded-lg transition-colors"
                  >
                    <img src=${donateIcon} alt="Donate" class="w-6 h-6" />
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
          </div>
        </div>
      </div>
    `;
  }
}
