import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import allianceIcon from "../../../../resources/images/AllianceIconWhite.svg";
import chatIcon from "../../../../resources/images/ChatIconWhite.svg";
import donateGoldIcon from "../../../../resources/images/DonateGoldIconWhite.svg";
import donateTroopIcon from "../../../../resources/images/DonateTroopIconWhite.svg";
import emojiIcon from "../../../../resources/images/EmojiIconWhite.svg";
import stopTradingIcon from "../../../../resources/images/StopIconWhite.png";
import targetIcon from "../../../../resources/images/TargetIconWhite.svg";
import startTradingIcon from "../../../../resources/images/TradingIconWhite.png";
import traitorIcon from "../../../../resources/images/TraitorIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { AllPlayers, PlayerActions } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { flattenedEmojiTable } from "../../../core/Util";
import { actionButton } from "../../components/ui/ActionButton";
import "../../components/ui/Divider";
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
import "./SendResourceModal";

@customElement("player-panel")
export class PlayerPanel extends LitElement implements Layer {
  public g: GameView;
  public eventBus: EventBus;
  public emojiTable: EmojiTable;
  public uiState: UIState;

  private actions: PlayerActions | null = null;
  private tile: TileRef | null = null;

  @state()
  private openSend = false;
  @state()
  private sendMode: "troops" | "gold" = "troops";
  @state()
  private sendTarget: PlayerView | null = null;
  @state()
  public isVisible: boolean = false;
  @state()
  private allianceExpiryText: string | null = null;
  @state()
  private allianceExpirySeconds: number | null = null;

  private openSendTroops(target: PlayerView) {
    this.sendTarget = target;
    this.sendMode = "troops";
    this.openSend = true;
  }

  private openSendGold(target: PlayerView) {
    this.sendTarget = target;
    this.sendMode = "gold";
    this.openSend = true;
  }
  private handleDonateTroopClick(e: Event, my: PlayerView, other: PlayerView) {
    e.stopPropagation();
    this.openSendTroops(other);
  }

  private handleDonateGoldClick(e: Event, my: PlayerView, other: PlayerView) {
    e.stopPropagation();
    this.openSendGold(other);
  }

  private closeSend = () => {
    this.openSend = false;
    this.sendTarget = null;
  };

  public show(actions: PlayerActions, tile: TileRef) {
    this.actions = actions;
    this.tile = tile;
    this.isVisible = true;
    this.requestUpdate();
  }

  public hide() {
    this.isVisible = false;
    this.openSend = false;
    this.sendTarget = null;
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

  private confirmSend = (
    e: CustomEvent<{ amount: number; closePanel?: boolean }>,
  ) => {
    const amount = Math.floor(Math.max(0, e.detail?.amount ?? 0));
    const myPlayer = this.g.myPlayer();
    const target = this.sendTarget;

    if (!myPlayer || !target || amount <= 0) return;

    if (this.sendMode === "troops") {
      if (amount > myPlayer.troops()) return;
      this.eventBus.emit(new SendDonateTroopsIntentEvent(target, amount));
    } else {
      // Normalize bigint → number for UI logic
      const rawGold =
        typeof (myPlayer as any).gold === "function"
          ? (myPlayer as any).gold()
          : 0;
      const myGold = Number(rawGold); // ensure number for comparisons/UI
      if (amount > myGold) return;

      this.eventBus.emit(new SendDonateGoldIntentEvent(target, BigInt(amount)));
    }

    this.closeSend();
    if (e.detail?.closePanel) this.hide();
  };

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
    e.stopPropagation();
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
          const remainingSeconds = Math.max(0, Math.floor(remainingTicks / 10)); // 10 ticks per second

          if (remainingTicks > 0) {
            this.allianceExpirySeconds = remainingSeconds;
            this.allianceExpiryText = renderDuration(remainingSeconds);
          } else {
            this.allianceExpirySeconds = null;
            this.allianceExpiryText = null;
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
    if (seconds === null) return "text-white"; // Default color

    if (seconds <= 30) return "text-red-400"; // Last 30 seconds: Red
    if (seconds <= 60) return "text-yellow-400"; // Last 60 seconds: Yellow
    return "text-emerald-400"; // More than 60 seconds: Green
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    const myPlayer = this.g.myPlayer();
    if (myPlayer === null) return html``;
    if (this.tile === null) return html``;
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
            class="relative mt-2 w-full border border-white/10  bg-zinc-900/95
       backdrop-blur-sm p-5 shadow-2xl ring-1 ring-white/5 rounded-xl"
          >
            <!-- Close button -->
            <button
              @click=${this.handleClose}
              class="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center
       rounded-full bg-zinc-700 text-white shadow hover:bg-red-500 transition-colors"
            >
              ✕
            </button>

            <div
              class="flex flex-col gap-2 font-sans antialiased text-[13px] text-zinc-200"
            >
              <!-- Name section -->
              <div class="mb-1 flex items-center gap-2.5">
                ${country
                  ? html`<img
                      src="/flags/${flagCode}.svg"
                      alt=${flagName}
                      class="h-10 w-10 rounded-full object-cover"
                    />`
                  : ""}
                <h1 class="text-xl font-semibold tracking-[-0.01em] truncate">
                  ${other?.name()}
                </h1>
              </div>

              ${this.openSend && this.sendTarget
                ? html`
                    <send-resource-modal
                      .open=${this.openSend}
                      .mode=${this.sendMode}
                      .total=${this.sendMode === "troops"
                        ? myPlayer.troops()
                        : typeof (myPlayer as any).gold === "function"
                          ? (myPlayer as any).gold()
                          : 0}
                      .uiState=${this.uiState}
                      .myPlayer=${myPlayer}
                      .target=${this.sendTarget}
                      .gameView=${this.g}
                      .format=${this.sendMode === "troops"
                        ? renderTroops
                        : renderNumber}
                      @confirm=${this.confirmSend}
                      @close=${this.closeSend}
                    ></send-resource-modal>
                  `
                : ""}

              <!-- Divider -->
              <ui-divider></ui-divider>

              <!-- Resources section -->
              <div class="mb-1 flex justify-between gap-2">
                <div
                  class="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-2.5 py-1
                  text-base font-medium text-zinc-200"
                >
                  <span class="mr-0.5">💰</span>
                  <span translate="no" class="inline-block w-[45px] text-right">
                    ${renderNumber(other.gold() || 0)}
                  </span>
                  <span class="opacity-90">
                    ${translateText("player_panel.gold")}
                  </span>
                </div>

                <div
                  class="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-2.5 py-1
                  text-base font-medium text-zinc-200"
                >
                  <span class="mr-0.5">🛡️</span>
                  <span translate="no" class="inline-block w-[45px] text-right">
                    ${renderTroops(other.troops() || 0)}
                  </span>
                  <span class="opacity-90">
                    ${translateText("player_panel.troops")}
                  </span>
                </div>
              </div>

              <!-- Divider -->
              <ui-divider></ui-divider>

              <!-- Trust -->
              <div class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-base">
                <div class="flex items-center gap-2 font-medium text-zinc-400">
                  <span aria-hidden="true">🤝</span>
                  <span>${translateText("player_panel.trust")}</span>
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
              <div class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-base">
                <div class="flex items-center gap-2 font-medium text-zinc-400">
                  <span aria-hidden="true">⚠️</span>
                  <span>${translateText("player_panel.betrayals")}</span>
                </div>

                <div class="text-right font-medium text-zinc-200">
                  ${other.data.betrayals ?? 0}
                </div>
              </div>

              <!-- Embargo -->
              <div class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-base">
                <div class="flex items-center gap-2 font-medium text-zinc-400">
                  <span aria-hidden="true">⚓</span>
                  <span>${translateText("player_panel.trading")}</span>
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
              <ui-divider></ui-divider>

              <!-- Alliances -->
              <div class="text-base">
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
                    class="max-h-[72px] overflow-y-auto p-2 text-sm text-zinc-200"
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
                      class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-base"
                    >
                      <div class="font-medium text-zinc-400">
                        ${translateText("player_panel.alliance_time_remaining")}
                      </div>
                      <div class="text-right font-medium">
                        <span
                          class="inline-flex items-center rounded-full px-2 py-0.5 text-sm font-semibold ${this.getExpiryColorClass(
                            this.allianceExpirySeconds,
                          )}"
                        >
                          ${this.allianceExpiryText}
                        </span>
                      </div>
                    </div>
                  `
                : ""}

              <!-- Divider -->
              <ui-divider></ui-divider>

              <!-- Action buttons -->
              <div class="flex flex-col gap-2">
                <div class="grid auto-cols-fr grid-flow-col gap-1">
                  <!-- Chat -->
                  ${actionButton({
                    onClick: (e: MouseEvent) =>
                      this.handleChat(e, myPlayer, other),
                    icon: chatIcon,
                    iconAlt: "Chat",
                    title: translateText("player_panel.chat"),
                    label: translateText("player_panel.chat"),
                  })}

                  <!-- Emotes -->
                  ${canSendEmoji
                    ? actionButton({
                        onClick: (e: MouseEvent) =>
                          this.handleEmojiClick(e, myPlayer, other),
                        icon: emojiIcon,
                        iconAlt: "Emoji",
                        title: translateText("player_panel.emotes"),
                        label: translateText("player_panel.emotes"),
                        type: "normal",
                      })
                    : ""}

                  <!-- Target -->
                  ${canTarget
                    ? actionButton({
                        onClick: (e: MouseEvent) =>
                          this.handleTargetClick(e, other),
                        icon: targetIcon,
                        iconAlt: "Target",
                        title: translateText("player_panel.target"),
                        label: translateText("player_panel.target"),
                        type: "normal",
                      })
                    : ""}

                  <!-- Send Troops -->
                  ${canDonateTroops
                    ? actionButton({
                        onClick: (e: MouseEvent) =>
                          this.handleDonateTroopClick(e, myPlayer, other),
                        icon: donateTroopIcon,
                        iconAlt: "Troops",
                        title: translateText("player_panel.send_troops"),
                        label: translateText("player_panel.troops"),
                        type: "normal",
                      })
                    : ""}

                  <!-- Send Gold -->
                  ${canDonateGold
                    ? actionButton({
                        onClick: (e: MouseEvent) =>
                          this.handleDonateGoldClick(e, myPlayer, other),
                        icon: donateGoldIcon,
                        iconAlt: "Gold",
                        title: translateText("player_panel.send_gold"),
                        label: translateText("player_panel.gold"),
                        type: "normal",
                      })
                    : ""}
                </div>

                <div class="grid auto-cols-fr grid-flow-col gap-1">
                  <!-- Trade toggle -->
                  ${other !== myPlayer
                    ? canEmbargo
                      ? actionButton({
                          onClick: (e: MouseEvent) =>
                            this.handleEmbargoClick(e, myPlayer, other),
                          icon: stopTradingIcon,
                          iconAlt: "Stop Trading",
                          title: translateText("player_panel.stop_trade"),
                          label: translateText("player_panel.stop_trade"),
                          type: "red",
                        })
                      : actionButton({
                          onClick: (e: MouseEvent) =>
                            this.handleStopEmbargoClick(e, myPlayer, other),
                          icon: startTradingIcon,
                          iconAlt: "Start Trading",
                          title: translateText("player_panel.start_trade"),
                          label: translateText("player_panel.start_trade"),
                          type: "green",
                        })
                    : ""}

                  <!-- Break Alliance -->
                  ${canBreakAlliance
                    ? actionButton({
                        onClick: (e: MouseEvent) =>
                          this.handleBreakAllianceClick(e, myPlayer, other),
                        icon: traitorIcon,
                        iconAlt: "Break Alliance",
                        title: translateText("player_panel.break_alliance"),
                        label: translateText("player_panel.break_alliance"),
                        type: "red",
                      })
                    : ""}

                  <!-- Send Alliance Request -->
                  ${canSendAllianceRequest
                    ? actionButton({
                        onClick: (e: MouseEvent) =>
                          this.handleAllianceClick(e, myPlayer, other),
                        icon: allianceIcon,
                        iconAlt: "Alliance",
                        title: translateText("player_panel.send_alliance"),
                        label: translateText("player_panel.send_alliance"),
                        type: "indigo",
                      })
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
