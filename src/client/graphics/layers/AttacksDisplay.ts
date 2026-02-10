import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { MessageType, PlayerType, UnitType } from "../../../core/game/Game";
import {
  AttackUpdate,
  GameUpdateType,
  UnitIncomingUpdate,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import {
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  SendAttackIntentEvent,
} from "../../Transport";
import { renderTroops, translateText } from "../../Utils";
import { getColoredSprite } from "../SpriteLoader";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import {
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
} from "./Leaderboard";
import swordIcon from "/images/SwordIcon.svg?url";

@customElement("attacks-display")
export class AttacksDisplay extends LitElement implements Layer {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  private active: boolean = false;
  private incomingBoatIDs: Set<number> = new Set();
  private spriteDataURLCache: Map<string, string> = new Map();
  @state() private _isVisible: boolean = false;
  @state() private incomingAttacks: AttackUpdate[] = [];
  @state() private outgoingAttacks: AttackUpdate[] = [];
  @state() private outgoingLandAttacks: AttackUpdate[] = [];
  @state() private outgoingBoats: UnitView[] = [];
  @state() private incomingBoats: UnitView[] = [];

  createRenderRoot() {
    return this;
  }

  init() {}

  tick() {
    this.active = true;

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this._isVisible = true;
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this._isVisible) {
        this._isVisible = false;
      }
      return;
    }

    // Track incoming boat unit IDs from UnitIncoming events
    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const event of updates[
        GameUpdateType.UnitIncoming
      ] as UnitIncomingUpdate[]) {
        if (
          event.playerID === myPlayer.smallID() &&
          event.messageType === MessageType.NAVAL_INVASION_INBOUND
        ) {
          this.incomingBoatIDs.add(event.unitID);
        }
      }
    }

    // Resolve incoming boats from tracked IDs, remove inactive ones
    const resolvedIncomingBoats: UnitView[] = [];
    for (const unitID of this.incomingBoatIDs) {
      const unit = this.game.unit(unitID);
      if (unit && unit.isActive() && unit.type() === UnitType.TransportShip) {
        resolvedIncomingBoats.push(unit);
      } else {
        this.incomingBoatIDs.delete(unitID);
      }
    }
    this.incomingBoats = resolvedIncomingBoats;

    this.incomingAttacks = myPlayer.incomingAttacks().filter((a) => {
      const t = (this.game.playerBySmallID(a.attackerID) as PlayerView).type();
      return t !== PlayerType.Bot;
    });

    this.outgoingAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID !== 0);

    this.outgoingLandAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID === 0);

    this.outgoingBoats = myPlayer
      .units()
      .filter((u) => u.type() === UnitType.TransportShip);

    this.requestUpdate();
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(): void {}

  private renderButton(options: {
    content: any;
    onClick?: () => void;
    className?: string;
    disabled?: boolean;
    translate?: boolean;
    hidden?: boolean;
  }) {
    const {
      content,
      onClick,
      className = "",
      disabled = false,
      translate = true,
      hidden = false,
    } = options;

    if (hidden) {
      return html``;
    }

    return html`
      <button
        class="${className}"
        @click=${onClick}
        ?disabled=${disabled}
        ?translate=${translate}
      >
        ${content}
      </button>
    `;
  }

  private emitCancelAttackIntent(id: string) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelAttackIntentEvent(id));
  }

  private emitBoatCancelIntent(id: number) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelBoatIntentEvent(id));
  }

  private emitGoToPlayerEvent(attackerID: number) {
    const attacker = this.game.playerBySmallID(attackerID) as PlayerView;
    this.eventBus.emit(new GoToPlayerEvent(attacker));
  }

  private getBoatSpriteDataURL(unit: UnitView): string {
    const owner = unit.owner();
    const key = `boat-${owner.id()}`;
    const cached = this.spriteDataURLCache.get(key);
    if (cached) return cached;
    try {
      const canvas = getColoredSprite(unit, this.game.config().theme());
      const dataURL = canvas.toDataURL();
      this.spriteDataURLCache.set(key, dataURL);
      return dataURL;
    } catch {
      return "";
    }
  }

  private async attackWarningOnClick(attack: AttackUpdate) {
    const playerView = this.game.playerBySmallID(attack.attackerID);
    if (playerView !== undefined) {
      if (playerView instanceof PlayerView) {
        const averagePosition = await playerView.attackAveragePosition(
          attack.attackerID,
          attack.id,
        );

        if (averagePosition === null) {
          this.emitGoToPlayerEvent(attack.attackerID);
        } else {
          this.eventBus.emit(
            new GoToPositionEvent(averagePosition.x, averagePosition.y),
          );
        }
      }
    } else {
      this.emitGoToPlayerEvent(attack.attackerID);
    }
  }

  private handleRetaliate(attack: AttackUpdate) {
    const attacker = this.game.playerBySmallID(attack.attackerID) as PlayerView;
    if (!attacker) return;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const counterTroops = Math.min(
      attack.troops,
      this.uiState.attackRatio * myPlayer.troops(),
    );
    this.eventBus.emit(new SendAttackIntentEvent(attacker.id(), counterTroops));
  }

  private renderIncomingAttacks() {
    if (this.incomingAttacks.length === 0) return html``;

    return this.incomingAttacks.map(
      (attack) => html`
        <div
          class="flex items-center gap-0.5 w-full bg-gray-800/70 backdrop-blur-xs rounded px-1.5 py-0.5 overflow-hidden"
        >
          ${this.renderButton({
            content: html`<img
                src="${swordIcon}"
                class="h-4 w-4 inline-block"
                style="filter: brightness(0) saturate(100%) invert(27%) sepia(91%) saturate(4551%) hue-rotate(348deg) brightness(89%) contrast(97%)"
              />
              <span class="inline-block min-w-[3rem] text-right"
                >${renderTroops(attack.troops)}</span
              >
              <span class="truncate"
                >${(
                  this.game.playerBySmallID(attack.attackerID) as PlayerView
                )?.name()}</span
              >
              ${attack.retreating
                ? `(${translateText("events_display.retreating")}...)`
                : ""} `,
            onClick: () => this.attackWarningOnClick(attack),
            className:
              "text-left text-red-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
            translate: false,
          })}
          ${!attack.retreating
            ? this.renderButton({
                content: html`<img
                  src="${swordIcon}"
                  class="h-4 w-4"
                  style="filter: brightness(0) saturate(100%) invert(27%) sepia(91%) saturate(4551%) hue-rotate(348deg) brightness(89%) contrast(97%)"
                />`,
                onClick: () => this.handleRetaliate(attack),
                className:
                  "ml-auto inline-flex items-center justify-center cursor-pointer bg-red-900/50 hover:bg-red-800/70 rounded px-1.5 py-1 border border-red-700/50",
                translate: false,
              })
            : ""}
        </div>
      `,
    );
  }

  private renderOutgoingAttacks() {
    if (this.outgoingAttacks.length === 0) return html``;

    return this.outgoingAttacks.map(
      (attack) => html`
        <div
          class="flex items-center gap-0.5 w-full bg-gray-800/70 backdrop-blur-xs rounded px-1.5 py-0.5 overflow-hidden"
        >
          ${this.renderButton({
            content: html`<img
                src="${swordIcon}"
                class="h-4 w-4 inline-block"
                style="filter: invert(1)"
              />
              <span class="inline-block min-w-[3rem] text-right"
                >${renderTroops(attack.troops)}</span
              >
              <span class="truncate"
                >${(
                  this.game.playerBySmallID(attack.targetID) as PlayerView
                )?.name()}</span
              > `,
            onClick: async () => this.attackWarningOnClick(attack),
            className:
              "text-left text-blue-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
            translate: false,
          })}
          ${!attack.retreating
            ? this.renderButton({
                content: "❌",
                onClick: () => this.emitCancelAttackIntent(attack.id),
                className: "ml-auto text-left shrink-0",
                disabled: attack.retreating,
              })
            : html`<span class="ml-auto shrink-0 text-blue-400"
                >(${translateText("events_display.retreating")}...)</span
              >`}
        </div>
      `,
    );
  }

  private renderOutgoingLandAttacks() {
    if (this.outgoingLandAttacks.length === 0) return html``;

    return this.outgoingLandAttacks.map(
      (landAttack) => html`
        <div
          class="flex items-center gap-0.5 w-full bg-gray-800/70 backdrop-blur-xs rounded px-1.5 py-0.5 overflow-hidden"
        >
          ${this.renderButton({
            content: html`<img
                src="${swordIcon}"
                class="h-4 w-4 inline-block"
                style="filter: invert(1)"
              />
              <span class="inline-block min-w-[3rem] text-right"
                >${renderTroops(landAttack.troops)}</span
              >
              ${translateText("help_modal.ui_wilderness")}`,
            className:
              "text-left text-gray-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
            translate: false,
          })}
          ${!landAttack.retreating
            ? this.renderButton({
                content: "❌",
                onClick: () => this.emitCancelAttackIntent(landAttack.id),
                className: "ml-auto text-left shrink-0",
                disabled: landAttack.retreating,
              })
            : html`<span class="ml-auto shrink-0 text-blue-400"
                >(${translateText("events_display.retreating")}...)</span
              >`}
        </div>
      `,
    );
  }

  private getBoatTargetName(boat: UnitView): string {
    const target = boat.targetTile();
    if (target === undefined) return "";
    const ownerID = this.game.ownerID(target);
    if (ownerID === 0) return "";
    const player = this.game.playerBySmallID(ownerID) as PlayerView;
    return player?.name() ?? "";
  }

  private renderBoatIcon(boat: UnitView) {
    const dataURL = this.getBoatSpriteDataURL(boat);
    if (!dataURL) return html``;
    return html`<img
      src="${dataURL}"
      class="h-5 w-5 inline-block"
      style="image-rendering: pixelated"
    />`;
  }

  private renderBoats() {
    if (this.outgoingBoats.length === 0) return html``;

    return this.outgoingBoats.map(
      (boat) => html`
        <div
          class="flex items-center gap-0.5 w-full bg-gray-800/70 backdrop-blur-xs rounded px-1.5 py-0.5 overflow-hidden"
        >
          ${this.renderButton({
            content: html`${this.renderBoatIcon(boat)}
              <span class="inline-block min-w-[3rem] text-right"
                >${renderTroops(boat.troops())}</span
              >
              <span class="truncate text-xs"
                >${this.getBoatTargetName(boat)}</span
              >`,
            onClick: () => this.eventBus.emit(new GoToUnitEvent(boat)),
            className:
              "text-left text-blue-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
            translate: false,
          })}
          ${!boat.retreating()
            ? this.renderButton({
                content: "❌",
                onClick: () => this.emitBoatCancelIntent(boat.id()),
                className: "ml-auto text-left shrink-0",
                disabled: boat.retreating(),
              })
            : html`<span class="ml-auto shrink-0 text-blue-400"
                >(${translateText("events_display.retreating")}...)</span
              >`}
        </div>
      `,
    );
  }

  private renderIncomingBoats() {
    if (this.incomingBoats.length === 0) return html``;

    return this.incomingBoats.map(
      (boat) => html`
        <div
          class="flex items-center gap-0.5 w-full bg-gray-800/70 backdrop-blur-xs rounded px-1.5 py-0.5 overflow-hidden"
        >
          ${this.renderButton({
            content: html`${this.renderBoatIcon(boat)}
              <span class="inline-block min-w-[3rem] text-right"
                >${renderTroops(boat.troops())}</span
              >
              <span class="truncate text-xs">${boat.owner()?.name()}</span>`,
            onClick: () => this.eventBus.emit(new GoToUnitEvent(boat)),
            className:
              "text-left text-red-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
            translate: false,
          })}
        </div>
      `,
    );
  }

  render() {
    if (!this.active || !this._isVisible) {
      return html``;
    }

    const hasAnything =
      this.outgoingAttacks.length > 0 ||
      this.outgoingLandAttacks.length > 0 ||
      this.outgoingBoats.length > 0 ||
      this.incomingAttacks.length > 0 ||
      this.incomingBoats.length > 0;

    if (!hasAnything) {
      return html``;
    }

    return html`
      <div
        class="w-full mb-1 pointer-events-auto grid grid-cols-2 lg:grid-cols-1 gap-1 text-white text-sm lg:text-base"
      >
        ${this.renderOutgoingAttacks()} ${this.renderOutgoingLandAttacks()}
        ${this.renderBoats()} ${this.renderIncomingAttacks()}
        ${this.renderIncomingBoats()}
      </div>
    `;
  }
}
