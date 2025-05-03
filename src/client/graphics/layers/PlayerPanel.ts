import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import donateGoldIcon from "../../../../resources/images/DonateGoldIconWhite.svg";
import donateTroopIcon from "../../../../resources/images/DonateTroopIconWhite.svg";
import emojiIcon from "../../../../resources/images/EmojiIconWhite.svg";
import targetIcon from "../../../../resources/images/TargetIconWhite.svg";
import traitorIcon from "../../../../resources/images/TraitorIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  PlayerActions,
  PlayerID,
  UnitType,
} from "../../../core/game/Game";
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

  private handleDonateTroopClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendDonateTroopsIntentEvent(myPlayer, other, null));
    this.hide();
  }

  private handleDonateGoldClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendDonateGoldIntentEvent(myPlayer, other, null));
    this.hide();
  }

  private handleEmbargoClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendEmbargoIntentEvent(myPlayer, other, "start"));
    this.hide();
  }

  private handleStopEmbargoClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.eventBus.emit(new SendEmbargoIntentEvent(myPlayer, other, "stop"));
    this.hide();
  }

  private handleEmojiClick(e: Event, myPlayer: PlayerView, other: PlayerView) {
    e.stopPropagation();
    this.emojiTable.showTable((emoji: string) => {
      if (myPlayer == other) {
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

  async tick() {
    if (this.isVisible && this.tile) {
      const myPlayer = this.g.myPlayer();
      if (myPlayer !== null && myPlayer.isAlive()) {
        this.actions = await myPlayer.actions(this.tile);
        this.requestUpdate();
      }
    }
  }

  getTotalNukesSent(otherId: PlayerID): number {
    const stats = this.g.player(otherId).stats();
    if (!stats) {
      return 0;
    }
    let sum = 0;
    const nukes = stats.sentNukes[this.g.myPlayer().id()];
    if (!nukes) {
      return 0;
    }
    for (const nukeType in nukes) {
      if (nukeType != UnitType.MIRVWarhead) {
        sum += nukes[nukeType];
      }
    }
    return sum;
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
      this.hide();
      console.warn("Tile is not owned by a player");
      return;
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
    const canEmbargo = this.actions.interaction?.canEmbargo;

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
                  Troops
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
              <div class="text-white text-opacity-80 text-sm px-2">Traitor</div>
              <div class="bg-opacity-50 bg-gray-700 rounded p-2 text-white">
                ${other.isTraitor() ? "Yes" : "No"}
              </div>
            </div>

            <!-- Embargo -->
            <div class="flex flex-col gap-1">
              <div class="text-white text-opacity-80 text-sm px-2">
                Embargo against you
              </div>
              <div class="bg-opacity-50 bg-gray-700 rounded p-2 text-white">
                ${other.hasEmbargoAgainst(myPlayer) ? "Yes" : "No"}
              </div>
            </div>

            <!-- Stats -->
            <div class="flex flex-col gap-1">
              <div class="text-white text-opacity-80 text-sm px-2">
                Nukes sent by them to you
              </div>
              <div class="bg-opacity-50 bg-gray-700 rounded p-2 text-white">
                ${this.getTotalNukesSent(other.id())}
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
                    @click=${(e) =>
                      this.handleDonateTroopClick(e, myPlayer, other)}
                    class="w-10 h-10 flex items-center justify-center
                           bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                           text-white rounded-lg transition-colors"
                  >
                    <img src=${donateTroopIcon} alt="Donate" class="w-6 h-6" />
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
            ${canEmbargo && other != myPlayer
              ? html`<button
                  @click=${(e) => this.handleEmbargoClick(e, myPlayer, other)}
                  class="w-100 h-10 flex items-center justify-center
                          bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                          text-white rounded-lg transition-colors"
                >
                  Stop trading
                </button>`
              : ""}
            ${!canEmbargo && other != myPlayer
              ? html`<button
                  @click=${(e) =>
                    this.handleStopEmbargoClick(e, myPlayer, other)}
                  class="w-100 h-10 flex items-center justify-center
                          bg-opacity-50 bg-gray-700 hover:bg-opacity-70
                          text-white rounded-lg transition-colors"
                >
                  Start trading
                </button>`
              : ""}
          </div>
        </div>
      </div>
    `;
  }
}
