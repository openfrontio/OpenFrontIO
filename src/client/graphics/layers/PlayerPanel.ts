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
import traitorIcon from "../../../../resources/images/TraitorIconLightRed.svg";
import breakAllianceIcon from "../../../../resources/images/TraitorIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import {
  AllPlayers,
  PlayerActions,
  PlayerProfile,
  PlayerType,
  Relation,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { Emoji, flattenedEmojiTable } from "../../../core/Util";
import { actionButton } from "../../components/ui/ActionButton";
import "../../components/ui/Divider";
import Countries from "../../data/countries.json";
import { CloseViewEvent, MouseUpEvent } from "../../InputHandler";
import {
  SendAllianceRequestIntentEvent,
  SendBreakAllianceIntentEvent,
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
  private _profileForPlayerId: number | null = null;

  @state() private sendTarget: PlayerView | null = null;
  @state() private sendMode: "troops" | "gold" | "none" = "none";
  @state() public isVisible: boolean = false;
  @state() private allianceExpiryText: string | null = null;
  @state() private allianceExpirySeconds: number | null = null;
  @state() private otherProfile: PlayerProfile | null = null;

  private ctModal: ChatModal;

  createRenderRoot() {
    return this;
  }

  initEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
    eventBus.on(CloseViewEvent, (e) => {
      if (this.isVisible) {
        this.hide();
      }
    });
  }

  init() {
    this.eventBus.on(MouseUpEvent, () => this.hide());

    this.ctModal = document.querySelector("chat-modal") as ChatModal;
    if (!this.ctModal) {
      console.warn("ChatModal element not found in DOM");
    }
  }

  async tick() {
    if (this.isVisible && this.tile) {
      const owner = this.g.owner(this.tile);
      if (owner && owner.isPlayer()) {
        const pv = owner as PlayerView;
        const id = pv.id();
        // fetch only if we don't have it or the player changed
        if (this._profileForPlayerId !== Number(id)) {
          this.otherProfile = await pv.profile();
          this._profileForPlayerId = Number(id);
        }
      }

      // Refresh actions & alliance expiry
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

  public show(actions: PlayerActions, tile: TileRef) {
    this.actions = actions;
    this.tile = tile;
    this.isVisible = true;
    this.requestUpdate();
  }

  public hide() {
    this.isVisible = false;
    this.sendMode = "none";
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

  private openSendTroops(target: PlayerView) {
    this.sendTarget = target;
    this.sendMode = "troops";
  }

  private openSendGold(target: PlayerView) {
    this.sendTarget = target;
    this.sendMode = "gold";
  }

  private handleDonateTroopClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.openSendTroops(other);
  }

  private handleDonateGoldClick(
    e: Event,
    myPlayer: PlayerView,
    other: PlayerView,
  ) {
    e.stopPropagation();
    this.openSendGold(other);
  }

  private closeSend = () => {
    this.sendTarget = null;
    this.sendMode = "none";
  };

  private confirmSend = (
    e: CustomEvent<{ amount: number; closePanel?: boolean }>,
  ) => {
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
            flattenedEmojiTable.indexOf(emoji as Emoji),
          ),
        );
      } else {
        this.eventBus.emit(
          new SendEmojiIntentEvent(
            other,
            flattenedEmojiTable.indexOf(emoji as Emoji),
          ),
        );
      }
      this.emojiTable.hideTable();
      this.hide();
    });
  }

  private handleChat(e: Event, sender: PlayerView, other: PlayerView) {
    e.stopPropagation();

    if (!this.ctModal) {
      console.warn("ChatModal element not found in DOM");
      return;
    }

    this.ctModal.open(sender, other);
    this.hide();
  }

  private handleTargetClick(e: Event, other: PlayerView) {
    e.stopPropagation();
    this.eventBus.emit(new SendTargetPlayerIntentEvent(other.id()));
    this.hide();
  }

  private identityChipProps(type: PlayerType) {
    switch (type) {
      case PlayerType.FakeHuman:
        return {
          labelKey: "player_type.nation",
          aria: "Nation player",
          classes: "border-indigo-400/25 bg-indigo-500/10 text-indigo-200",
          icon: "🏛️",
        };
      case PlayerType.Bot:
        return {
          labelKey: "player_type.bot",
          aria: "Bot",
          classes: "border-purple-400/25 bg-purple-500/10 text-purple-200",
          icon: "🤖",
        };
      case PlayerType.Human:
      default:
        return {
          labelKey: "player_type.player",
          aria: "Human player",
          classes: "border-zinc-400/20 bg-zinc-500/5 text-zinc-300",
          icon: "👤",
        };
    }
  }

  private getRelationClass(relation: Relation): string {
    const base =
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 " +
      "shadow-[inset_0_0_8px_rgba(255,255,255,0.04)]";

    switch (relation) {
      case Relation.Hostile:
        return `${base} border-red-400/30 bg-red-500/10 text-red-200`;
      case Relation.Distrustful:
        return `${base} border-red-300/40 bg-red-300/10 text-red-300`;
      case Relation.Friendly:
        return `${base} border-emerald-400/30 bg-emerald-500/10 text-emerald-200`;
      case Relation.Neutral:
      default:
        return `${base} border-zinc-400/30 bg-zinc-500/10 text-zinc-200`;
    }
  }

  private getRelationName(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return translateText("relation.hostile");
      case Relation.Distrustful:
        return translateText("relation.distrustful");
      case Relation.Friendly:
        return translateText("relation.friendly");
      case Relation.Neutral:
      default:
        return translateText("relation.neutral");
    }
  }

  private getExpiryColorClass(seconds: number | null): string {
    if (seconds === null) return "text-white"; // Default color

    if (seconds <= 30) return "text-red-400"; // Last 30 seconds: Red
    if (seconds <= 60) return "text-yellow-400"; // Last 60 seconds: Yellow
    return "text-emerald-400"; // More than 60 seconds: Green
  }

  private getTraitorRemainingSeconds(player: PlayerView): number | null {
    const ticksLeft = player.data.traitorRemainingTicks ?? 0;
    if (!player.isTraitor() || ticksLeft <= 0) return null;
    return Math.ceil(ticksLeft / 10); // 10 ticks = 1 second
  }

  private renderTraitorBadge(other: PlayerView) {
    if (!other.isTraitor()) return html``;

    const secs = this.getTraitorRemainingSeconds(other);
    const label = secs !== null ? renderDuration(secs) : null;
    const dotCls =
      secs !== null
        ? `mx-1 h-[4px] w-[4px] rounded-full bg-red-400/70 ${secs <= 10 ? "animate-pulse" : ""}`
        : "";

    return html`
      <div class="mt-1" role="status" aria-live="polite" aria-atomic="true">
        <span
          class="inline-flex items-center gap-2 rounded-full border border-red-400/30
            bg-red-500/10 px-2.5 py-0.5 text-sm font-semibold text-red-200
            shadow-[inset_0_0_8px_rgba(239,68,68,0.12)]"
          title=${translateText("player_panel.traitor")}
        >
          <img
            src=${traitorIcon}
            alt=""
            aria-hidden="true"
            class="h-[18px] w-[18px]"
          />
          <span class="tracking-tight"
            >${translateText("player_panel.traitor")}</span
          >
          ${label
            ? html`<span class=${dotCls}></span>
                <span
                  class="tabular-nums font-bold text-red-100 whitespace-nowrap text-sm"
                >
                  ${label}
                </span>`
            : ""}
        </span>
      </div>
    `;
  }

  private renderRelationPillIfNation(other: PlayerView, my: PlayerView) {
    if (other.type() !== PlayerType.FakeHuman) return html``;
    if (other.isTraitor()) return html``;
    if (my?.isAlliedWith && my.isAlliedWith(other)) return html``;
    if (!this.otherProfile || !my) return html``;

    const relation =
      this.otherProfile.relations?.[my.smallID()] ?? Relation.Neutral;
    const cls = this.getRelationClass(relation);
    const name = this.getRelationName(relation);

    return html`
      <div class="mt-1">
        <span class="text-sm font-semibold ${cls}">${name}</span>
      </div>
    `;
  }

  private renderIdentityRow(other: PlayerView, my: PlayerView) {
    const flagCode = other.cosmetics.flag;
    const country =
      typeof flagCode === "string"
        ? Countries.find((c) => c.code === flagCode)
        : undefined;

    const chip =
      other.type() === PlayerType.Human
        ? null
        : this.identityChipProps(other.type());

    return html`
      <div class="flex items-center gap-2.5 flex-wrap">
        ${country && typeof flagCode === "string"
          ? html`<img
              src="/flags/${encodeURIComponent(flagCode)}.svg"
              alt=${country?.name || "Flag"}
              class="h-10 w-10 rounded-full object-cover"
              @error=${(e: Event) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />`
          : ""}

        <div class="flex-1 min-w-0">
          <h1
            class="text-xl font-bold tracking-[-0.01em] text-zinc-50 truncate"
            title=${other.name()}
          >
            ${other.name()}
          </h1>
        </div>
        ${chip
          ? html`<span
              class=${`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${chip.classes}`}
              role="status"
              aria-label=${chip.aria}
              title=${translateText(chip.labelKey)}
            >
              <span aria-hidden="true" class="leading-none">${chip.icon}</span>
              <span class="tracking-tight"
                >${translateText(chip.labelKey)}</span
              >
            </span>`
          : html``}
      </div>
      ${this.renderTraitorBadge(other)}
      ${this.renderRelationPillIfNation(other, my)}
    `;
  }

  private renderResources(other: PlayerView) {
    return html`
      <div class="mb-1 flex justify-between gap-2">
        <div
          class="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-3 py-1.5 
                    text-white w-[140px] min-w-[140px] flex-shrink-0"
        >
          <span class="mr-0.5">💰</span>
          <span translate="no" class="tabular-nums font-semibold">
            ${renderNumber(other.gold() || 0)}
          </span>
          <span class="text-white/80 whitespace-nowrap">
            ${translateText("player_panel.gold")}</span
          >
        </div>

        <div
          class="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-3 py-1.5 
                    text-white w-[140px] min-w-[140px] flex-shrink-0"
        >
          <span class="mr-0.5">🛡️</span>
          <span translate="no" class="tabular-nums font-semibold">
            ${renderTroops(other.troops() || 0)}
          </span>
          <span class="text-white/80 whitespace-nowrap">
            ${translateText("player_panel.troops")}</span
          >
        </div>
      </div>
    `;
  }

  private renderStats(other: PlayerView, my: PlayerView) {
    return html`
      <!-- Betrayals -->
      <div class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2">
        <div
          class="flex items-center gap-2 text-[15px] font-medium text-zinc-100 leading-snug"
        >
          <span aria-hidden="true">⚠️</span>
          <span>${translateText("player_panel.betrayals")}</span>
        </div>
        <div class="text-right text-[14px] font-semibold text-zinc-200">
          ${other.data.betrayals ?? 0}
        </div>
      </div>

      <!-- Trading / Embargo -->
      <div class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2">
        <div
          class="flex items-center gap-2 text-[15px] font-medium text-zinc-100 leading-snug"
        >
          <span aria-hidden="true">⚓</span>
          <span>${translateText("player_panel.trading")}</span>
        </div>
        <div
          class="flex items-center justify-end gap-2 text-[14px] font-semibold"
        >
          ${other.hasEmbargoAgainst(my)
            ? html`<span class="text-amber-400"
                >${translateText("player_panel.stopped")}</span
              >`
            : html`<span class="text-blue-400"
                >${translateText("player_panel.active")}</span
              >`}
        </div>
      </div>
    `;
  }

  private renderAlliances(other: PlayerView) {
    const allies = other.allies();
    const names = allies.map((p) => p.name());
    const listText = names.length
      ? names.join(" • ")
      : translateText("common.none");

    return html`
      <div class="select-none">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[15px] font-medium text-zinc-100">
            ${translateText("player_panel.alliances")}
          </div>
          <span
            aria-label="Alliance count"
            class="inline-flex items-center justify-center min-w-[20px] h-5 px-[6px] rounded-[10px]
                 text-[12px] text-zinc-100 bg-white/10 border border-white/20"
          >
            ${allies.length}
          </span>
        </div>

        <div
          class="rounded-lg bg-zinc-800/70 ring-1 ring-zinc-700/60 w-full min-w-0"
        >
          <div
            class="max-h-[120px] overflow-y-auto p-2 text-zinc-100 text-[14.5px] leading-[1.35]
                 whitespace-normal break-words scrollbar-thin
                 scrollbar-thumb-zinc-600 hover:scrollbar-thumb-zinc-500 scrollbar-track-zinc-800"
            translate="no"
            aria-label="Alliances"
          >
            ${listText}
          </div>
        </div>
      </div>
    `;
  }

  private renderAllianceExpiry() {
    if (this.allianceExpiryText === null) return html``;
    return html`
      <div class="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-base">
        <div class="font-semibold text-zinc-300">
          ${translateText("player_panel.alliance_time_remaining")}
        </div>
        <div class="text-right font-semibold">
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-[14px] font-bold ${this.getExpiryColorClass(
              this.allianceExpirySeconds,
            )}"
            >${this.allianceExpiryText}</span
          >
        </div>
      </div>
    `;
  }

  private renderActions(my: PlayerView, other: PlayerView) {
    const myPlayer = this.g.myPlayer();
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

    return html`
      <div class="flex flex-col gap-2">
        <div class="grid auto-cols-fr grid-flow-col gap-1">
          ${actionButton({
            onClick: (e: MouseEvent) => this.handleChat(e, my, other),
            icon: chatIcon,
            iconAlt: "Chat",
            title: translateText("player_panel.chat"),
            label: translateText("player_panel.chat"),
          })}
          ${canSendEmoji
            ? actionButton({
                onClick: (e: MouseEvent) => this.handleEmojiClick(e, my, other),
                icon: emojiIcon,
                iconAlt: "Emoji",
                title: translateText("player_panel.emotes"),
                label: translateText("player_panel.emotes"),
                type: "normal",
              })
            : ""}
          ${canTarget
            ? actionButton({
                onClick: (e: MouseEvent) => this.handleTargetClick(e, other),
                icon: targetIcon,
                iconAlt: "Target",
                title: translateText("player_panel.target"),
                label: translateText("player_panel.target"),
                type: "normal",
              })
            : ""}
          ${canDonateTroops
            ? actionButton({
                onClick: (e: MouseEvent) =>
                  this.handleDonateTroopClick(e, my, other),
                icon: donateTroopIcon,
                iconAlt: "Troops",
                title: translateText("player_panel.send_troops"),
                label: translateText("player_panel.troops"),
                type: "normal",
              })
            : ""}
          ${canDonateGold
            ? actionButton({
                onClick: (e: MouseEvent) =>
                  this.handleDonateGoldClick(e, my, other),
                icon: donateGoldIcon,
                iconAlt: "Gold",
                title: translateText("player_panel.send_gold"),
                label: translateText("player_panel.gold"),
                type: "normal",
              })
            : ""}
        </div>
        <ui-divider></ui-divider>

        <div class="grid auto-cols-fr grid-flow-col gap-1">
          ${other !== my
            ? canEmbargo
              ? actionButton({
                  onClick: (e: MouseEvent) =>
                    this.handleEmbargoClick(e, my, other),
                  icon: stopTradingIcon,
                  iconAlt: "Stop Trading",
                  title: translateText("player_panel.stop_trade"),
                  label: translateText("player_panel.stop_trade"),
                  type: "yellow",
                })
              : actionButton({
                  onClick: (e: MouseEvent) =>
                    this.handleStopEmbargoClick(e, my, other),
                  icon: startTradingIcon,
                  iconAlt: "Start Trading",
                  title: translateText("player_panel.start_trade"),
                  label: translateText("player_panel.start_trade"),
                  type: "green",
                })
            : ""}
          ${canBreakAlliance
            ? actionButton({
                onClick: (e: MouseEvent) =>
                  this.handleBreakAllianceClick(e, my, other),
                icon: breakAllianceIcon,
                iconAlt: "Break Alliance",
                title: translateText("player_panel.break_alliance"),
                label: translateText("player_panel.break_alliance"),
                type: "red",
              })
            : ""}
          ${canSendAllianceRequest
            ? actionButton({
                onClick: (e: MouseEvent) =>
                  this.handleAllianceClick(e, my, other),
                icon: allianceIcon,
                iconAlt: "Alliance",
                title: translateText("player_panel.send_alliance"),
                label: translateText("player_panel.send_alliance"),
                type: "indigo",
              })
            : ""}
        </div>
      </div>
    `;
  }

  render() {
    if (!this.isVisible) return html``;

    const my = this.g.myPlayer();
    if (!my) return html``;
    if (!this.tile) return html``;

    const owner = this.g.owner(this.tile);
    if (!owner || !owner.isPlayer()) {
      this.hide();
      console.warn("Tile is not owned by a player");
      return html``;
    }
    const other = owner as PlayerView;
    const myGoldNum = my.gold();
    const myTroopsNum = Number(my.troops());

    return html`
      <style>
        /* Soft glowing ring animation for traitors */
        .traitor-ring {
          border-radius: 1rem;
          box-shadow:
            0 0 0 2px rgba(239, 68, 68, 0.34),
            0 0 12px 4px rgba(239, 68, 68, 0.22),
            inset 0 0 14px rgba(239, 68, 68, 0.13);
          animation: glowPulse 2.4s ease-in-out infinite;
        }
        @keyframes glowPulse {
          0%,
          100% {
            box-shadow:
              0 0 0 2px rgba(239, 68, 68, 0.22),
              0 0 8px 2px rgba(239, 68, 68, 0.15),
              inset 0 0 8px rgba(239, 68, 68, 0.07);
          }
          50% {
            box-shadow:
              0 0 0 4px rgba(239, 68, 68, 0.38),
              0 0 18px 6px rgba(239, 68, 68, 0.26),
              inset 0 0 18px rgba(239, 68, 68, 0.15);
          }
        }
      </style>

      <div
        class="fixed inset-0 z-[1001] flex items-center justify-center overflow-auto
               bg-black/15 backdrop-brightness-110 pointer-events-auto"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
        @wheel=${(e: MouseEvent) => e.stopPropagation()}
        @click=${() => this.hide()}
      >
        <div
          class="pointer-events-auto max-h-[90vh] min-w-[300px] max-w-[400px] px-4 py-2"
          @click=${(e: MouseEvent) => e.stopPropagation()}
        >
          <div class="relative">
            <div
              class="absolute inset-2 -z-10 rounded-2xl bg-black/25 backdrop-blur-[2px]"
            ></div>
            <div
              class=${`relative w-full bg-zinc-900/95 p-6 rounded-2xl text-zinc-100 overflow-visible 
                 ${other.isTraitor() ? "traitor-ring" : "ring-1 ring-white/5"}`}
            >
              <!-- Close button -->
              <button
                @click=${this.handleClose}
                class="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center
                     rounded-full bg-zinc-700 text-white shadow hover:bg-red-500 transition-colors"
                aria-label=${translateText("common.close") || "Close"}
                title=${translateText("common.close") || "Close"}
              >
                ✕
              </button>

              <div
                class="flex flex-col gap-2 font-sans antialiased text-[14px] leading-relaxed"
              >
                <!-- Identity (flag, name, type, traitor, relation) -->
                <div class="mb-1">${this.renderIdentityRow(other, my)}</div>

                ${this.sendTarget
                  ? html`
                      <send-resource-modal
                        .open=${this.sendMode !== "none"}
                        .mode=${this.sendMode}
                        .total=${this.sendMode === "troops"
                          ? myTroopsNum
                          : myGoldNum}
                        .uiState=${this.uiState}
                        .myPlayer=${my}
                        .target=${this.sendTarget}
                        .gameView=${this.g}
                        .eventBus=${this.eventBus}
                        .format=${this.sendMode === "troops"
                          ? renderTroops
                          : renderNumber}
                        @confirm=${this.confirmSend}
                        @close=${this.closeSend}
                      ></send-resource-modal>
                    `
                  : ""}

                <ui-divider></ui-divider>

                <!-- Resources -->
                ${this.renderResources(other)}

                <ui-divider></ui-divider>

                <!-- Stats: betrayals / trading -->
                ${this.renderStats(other, my)}

                <ui-divider></ui-divider>

                <!-- Alliances list -->
                ${this.renderAlliances(other)}

                <!-- Alliance time remaining -->
                ${this.renderAllianceExpiry()}

                <ui-divider></ui-divider>

                <!-- Actions -->
                ${this.renderActions(my, other)}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
