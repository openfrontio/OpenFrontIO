import {
  MessageType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  AttackUpdate,
  GameUpdateType,
  UnitIncomingUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import { renderTroops } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import "../../components/OfIcon";
import { Controller } from "../../Controller";
import { themeProvider } from "../../theme/ThemeProvider";
import {
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
} from "../../TransformHandler";
import {
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  counterAttackTroops,
  SendAttackIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView, PlayerView, UnitView } from "../../view";
import { getColoredSprite } from "../SpriteLoader";

// Look. Sizes, colours, radii and spacing of each part live here, so a
// change of look is one edit. The templates below only hold structure.

// Three 26px rows and two gaps, then the list scrolls. The scrollbar has a
// fixed colour so it still shows over the map at 0% HUD opacity.
const LIST =
  "pointer-events-auto grid w-full grid-cols-2 gap-1 mb-1 mt-1 sm:mt-0 px-1 sm:px-0 max-h-[5.375rem] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgb(255_255_255_/_0.35)_transparent] text-[13px] text-white";
const ROW =
  "@container relative flex h-6.5 min-w-0 items-center hud-panel rounded-md";
// A child, not the row's own background: the row's is the HUD panel's.
const ROW_TINT_IN =
  "pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-r from-red-500/15 to-red-500/5";
const ROW_TONE = { in: "text-red-400", out: "text-aquarius" } as const;
const FOCUS =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-aquarius";
const GO_TO = `relative flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-s-md ps-1.5 pe-1 text-start pointer-fine:hover:bg-white/5 ${FOCUS}`;
const ICON_SIZE = { lead: 14, retaliate: 13, cancel: 12 } as const;
const BOAT_ICON = "size-4.5 shrink-0";
const TROOPS = "shrink-0 font-bold tabular-nums";
const NAME = "min-w-0 truncate";
const NAME_TONE = {
  attack: "text-white/70",
  boat: "text-white/70",
  land: "text-white/55",
} as const;
const ETA = "ms-auto shrink-0 text-[11px] tabular-nums text-white/55";
const END_BUTTON = `relative me-0.5 grid size-5.5 shrink-0 place-items-center rounded-sm ${FOCUS}`;
const RETALIATE = "bg-red-500/20 text-white hover:bg-red-500/40";
const CANCEL = "text-white/55 hover:bg-white/10 hover:text-white";
// At most half the row, so the troops beside it are never covered.
const RETREATING =
  "relative max-w-1/2 shrink truncate pe-1.5 text-[11px] text-white/55";

/** One line of the list: an attack or a boat, mine or coming at me. */
interface AttackRow {
  dir: "in" | "out";
  kind: "attack" | "land" | "boat";
  troops: number;
  name: string;
  boat?: UnitView;
  eta?: string;
  retreating: boolean;
  onGoTo?: () => void;
  onRetaliate?: () => void;
  onCancel?: () => void;
}

@customElement("attacks-display")
export class AttacksDisplay extends LitElement implements Controller {
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
      const canvas = getColoredSprite(unit, themeProvider.current());
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
        const attacks = await playerView.attackClusteredPositions(attack.id);
        const pos = attacks[0]?.positions[0];

        if (!pos) {
          this.emitGoToPlayerEvent(attack.attackerID);
        } else {
          this.eventBus.emit(new GoToPositionEvent(pos.x, pos.y));
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

    const counterTroops = counterAttackTroops(
      attack.troops,
      this.uiState.attackRatio * myPlayer.troops(),
    );
    this.eventBus.emit(new SendAttackIntentEvent(attacker.id(), counterTroops));
  }

  private getBoatTargetName(boat: UnitView): string {
    const target = boat.targetTile();
    if (target === undefined) return "";
    const ownerID = this.game.ownerID(target);
    if (ownerID === 0) return translateText("help_modal.ui_wilderness");
    const player = this.game.playerBySmallID(ownerID) as PlayerView;
    return player?.displayName() ?? "";
  }

  private renderBoatIcon(boat: UnitView) {
    const dataURL = this.getBoatSpriteDataURL(boat);
    if (!dataURL) return html``;
    return html`<img
      src="${dataURL}"
      class=${BOAT_ICON}
      style="image-rendering: pixelated"
    />`;
  }

  private getBoatETA(boat: UnitView): string {
    const plan = this.game.motionPlans().get(boat.id());
    if (!plan) return "";

    const planSteps = plan.path.length;
    const planTicks = planSteps * plan.ticksPerStep;
    const planEndTick = plan.startTick + planTicks;

    const remainingTicks = planEndTick - this.game.ticks();
    if (remainingTicks <= 0) return "0s";
    const remainingMs = remainingTicks * this.game.config().msPerTick();
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    // e.g. return 1s, 35s, 59s, 1m, 1m1s, 1m59s, 2m, etc
    const m = Math.floor(remainingSeconds / 60); // minutes
    const s = remainingSeconds % 60; // seconds
    return (m ? `${m}m` : "") + (s ? `${s}s` : "");
  }

  private incomingAttackRows(): AttackRow[] {
    return this.incomingAttacks.map((attack) => ({
      dir: "in",
      kind: "attack",
      troops: attack.troops,
      name:
        (
          this.game.playerBySmallID(attack.attackerID) as PlayerView
        )?.displayName() ?? "",
      retreating: attack.retreating,
      onGoTo: () => this.attackWarningOnClick(attack),
      onRetaliate: () => this.handleRetaliate(attack),
    }));
  }

  private incomingBoatRows(): AttackRow[] {
    return this.incomingBoats.map((boat) => ({
      dir: "in",
      kind: "boat",
      troops: boat.troops(),
      name: boat.owner()?.displayName() ?? "",
      boat,
      eta: this.getBoatETA(boat),
      retreating: false,
      onGoTo: () => this.eventBus.emit(new GoToUnitEvent(boat)),
    }));
  }

  private outgoingAttackRows(): AttackRow[] {
    return this.outgoingAttacks.map((attack) => ({
      dir: "out",
      kind: "attack",
      troops: attack.troops,
      name:
        (
          this.game.playerBySmallID(attack.targetID) as PlayerView
        )?.displayName() ?? "",
      retreating: attack.retreating,
      onGoTo: () => this.attackWarningOnClick(attack),
      onCancel: () => this.emitCancelAttackIntent(attack.id),
    }));
  }

  private landAttackRows(): AttackRow[] {
    return this.outgoingLandAttacks.map((attack) => ({
      dir: "out",
      kind: "land",
      troops: attack.troops,
      name: translateText("help_modal.ui_wilderness"),
      retreating: attack.retreating,
      onCancel: () => this.emitCancelAttackIntent(attack.id),
    }));
  }

  private outgoingBoatRows(): AttackRow[] {
    return this.outgoingBoats.map((boat) => ({
      dir: "out",
      kind: "boat",
      troops: boat.troops(),
      name: this.getBoatTargetName(boat),
      boat,
      eta: this.getBoatETA(boat),
      retreating: boat.transportShipState().isRetreating,
      onGoTo: () => this.eventBus.emit(new GoToUnitEvent(boat)),
      onCancel: () => this.emitBoatCancelIntent(boat.id()),
    }));
  }

  private renderRow(row: AttackRow) {
    let end: TemplateResult | typeof nothing = nothing;
    if (row.retreating) {
      end = html`<span class=${RETREATING}
        >(${translateText("events_display.retreating")}...)</span
      >`;
    } else if (row.onRetaliate) {
      const label = translateText("user_setting.retaliate_attack");
      end = html`<button
        data-attack-action="retaliate"
        class="${END_BUTTON} ${RETALIATE}"
        aria-label=${label}
        title=${label}
        @click=${row.onRetaliate}
      >
        <of-icon name="sword" size=${ICON_SIZE.retaliate}></of-icon>
      </button>`;
    } else if (row.onCancel) {
      const label = translateText("common.cancel");
      end = html`<button
        data-attack-action="cancel"
        class="${END_BUTTON} ${CANCEL}"
        aria-label=${label}
        title=${label}
        @click=${row.onCancel}
      >
        <of-icon name="close" size=${ICON_SIZE.cancel}></of-icon>
      </button>`;
    }

    // translate="no" keeps the browser's translator off player names.
    return html`
      <div
        data-attack-row
        data-attack-dir=${row.dir}
        data-attack-kind=${row.kind}
        ?data-retreating=${row.retreating}
        translate="no"
        class=${ROW}
      >
        ${
          row.dir === "in"
            ? html`<span aria-hidden="true" class=${ROW_TINT_IN}></span>`
            : nothing
        }
        <button
          data-attack-action="goto"
          class=${GO_TO}
          ?disabled=${!row.onGoTo}
          @click=${row.onGoTo}
        >
          ${
            row.boat
              ? this.renderBoatIcon(row.boat)
              : html`<of-icon
                  name=${row.dir === "in" ? "shield" : "sword"}
                  size=${ICON_SIZE.lead}
                  class=${ROW_TONE[row.dir]}
                ></of-icon>`
          }
          <span class="${TROOPS} ${ROW_TONE[row.dir]}"
            >${renderTroops(row.troops)}</span
          >
          <span class="${NAME} ${NAME_TONE[row.kind]}">${row.name}</span>
          ${row.eta ? html`<span class=${ETA}>${row.eta}</span>` : nothing}
        </button>
        ${end}
      </div>
    `;
  }

  render() {
    if (!this.active || !this._isVisible) {
      return html``;
    }

    // Attacks on me first: the list shows three rows before it scrolls, and
    // those are the ones that need an answer.
    const rows = [
      ...this.incomingAttackRows(),
      ...this.incomingBoatRows(),
      ...this.outgoingAttackRows(),
      ...this.landAttackRows(),
      ...this.outgoingBoatRows(),
    ];
    if (rows.length === 0) {
      return html``;
    }

    return html`
      <div class=${LIST}>${rows.map((row) => this.renderRow(row))}</div>
    `;
  }
}
