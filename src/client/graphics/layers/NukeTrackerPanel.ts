import { html, LitElement, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameView, UnitView } from "../../../core/game/GameView";
import {
  CancelBombIntentEvent,
  ClearFlightPathHighlightEvent,
  HighlightFlightPathEvent,
} from "../../Transport";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

import mirvIcon from "../../../../resources/images/MIRVIcon.svg";
import {
  default as atomBombIcon,
  default as hydrogenBombIcon,
} from "../../../../resources/images/MushroomCloudIconWhite.svg";

interface OutboundBomb {
  id: number;
  type: UnitType;
  unit: UnitView;
  progress: number;
  canCancel: boolean;
}

@customElement("nuke-tracker-panel")
export class NukeTrackerPanel extends LitElement implements Layer {
  public eventBus: EventBus;
  public game: GameView;
  @property({ attribute: false }) tickCount: number = 0;

  @state() private outboundBombs: OutboundBomb[] = [];
  @state() private hoveredBomb: OutboundBomb | null = null;
  @state() private isVisible: boolean = false;

  // Cache initial total distance to target per bomb to compute accurate progress
  private initialDistanceByBomb = new Map<number, number>();

  createRenderRoot() {
    return this;
  }

  init() {
    // Initialize the component
    this.initialDistanceByBomb.clear();
  }

  tick() {
    this.updateOutboundBombs();
    this.requestUpdate();
  }

  protected updated(changed: PropertyValues) {
    if (changed.has("tickCount") || changed.has("game")) {
      this.updateOutboundBombs();
    }
  }

  private updateOutboundBombs() {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      this.outboundBombs = [];
      this.isVisible = false;
      this.initialDistanceByBomb.clear();
      return;
    }

    // Get all outbound bombs owned by the current player
    const bombTypes = [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV];
    const bombs: OutboundBomb[] = [];

    const seen = new Set<number>();

    for (const bombType of bombTypes) {
      const units = this.game.units(bombType);
      for (const unit of units) {
        if (unit.owner().id() === myPlayer.id() && unit.isActive()) {
          const id = unit.id();
          seen.add(id);

          // Establish initial total distance at first sight of this bomb
          const targetTile = unit.targetTile?.();
          const currentTile = unit.tile?.();
          if (targetTile && currentTile) {
            if (!this.initialDistanceByBomb.has(id)) {
              const totalDist = Math.max(
                1,
                this.game.manhattanDist(currentTile, targetTile),
              );
              this.initialDistanceByBomb.set(id, totalDist);
            }
          }

          const progress = this.calculateBombProgress(unit);

          let canCancel = false;
          if (bombType === UnitType.MIRV) {
            canCancel = true;
          } else {
            const cfg = this.game?.config?.();
            const threshold = cfg.cancelNukeUntilPercentage() ?? 90;
            canCancel = progress <= threshold;
          }

          bombs.push({
            id,
            type: bombType,
            unit,
            progress,
            canCancel,
          });
        }
      }
    }

    // Garbage collect initial distance entries for bombs no longer tracked
    for (const id of Array.from(this.initialDistanceByBomb.keys())) {
      if (!seen.has(id)) this.initialDistanceByBomb.delete(id);
    }

    this.outboundBombs = bombs;
    this.isVisible = bombs.length > 0;
  }

  private calculateBombProgress(unit: UnitView): number {
    const targetTile = unit.targetTile?.();
    const currentTile = unit.tile?.();

    if (!targetTile || !currentTile) {
      return 0;
    }

    const id = unit.id();
    const totalDist = this.initialDistanceByBomb.get(id);
    if (!totalDist || totalDist <= 0) {
      // Establish a conservative baseline if missing
      const dist = Math.max(
        1,
        this.game.manhattanDist(currentTile, targetTile),
      );
      this.initialDistanceByBomb.set(id, dist);
      return 0;
    }

    const remaining = this.game.manhattanDist(currentTile, targetTile);
    const traveled = Math.max(0, totalDist - remaining);
    const pct = (traveled / totalDist) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  private getBombIcon(bombType: UnitType): string {
    switch (bombType) {
      case UnitType.AtomBomb:
        return atomBombIcon;
      case UnitType.HydrogenBomb:
        return hydrogenBombIcon;
      case UnitType.MIRV:
        return mirvIcon;
      default:
        return atomBombIcon;
    }
  }

  private getBombDisplayName(bombType: UnitType): string {
    switch (bombType) {
      case UnitType.AtomBomb:
        return translateText("unit_type.atom_bomb");
      case UnitType.HydrogenBomb:
        return translateText("unit_type.hydrogen_bomb");
      case UnitType.MIRV:
        return translateText("unit_type.mirv");
      default:
        return translateText("common.unknown");
    }
  }

  private onBombHover(bomb: OutboundBomb | null) {
    this.hoveredBomb = bomb;
    if (bomb) {
      this.eventBus.emit(new HighlightFlightPathEvent(bomb.unit.id()));
    } else {
      this.eventBus.emit(new ClearFlightPathHighlightEvent());
    }
  }

  private onCancelBomb(bomb: OutboundBomb) {
    if (!bomb.canCancel) {
      return;
    }

    // Emit event to cancel the bomb
    this.eventBus.emit(new CancelBombIntentEvent(bomb.id));
  }

  private getProgressColor(progress: number): string {
    if (progress <= 50) return "#22c55e"; // green-500
    if (progress <= 70) return "#eab308"; // yellow-500
    if (progress <= 90) return "#f97316"; // orange-500
    return "#ef4444"; // red-500
  }

  render() {
    if (!this.isVisible) return "";

    return html`
      <div
        class="flex flex-col justify-end items-center gap-2 overflow-y-auto scrollbar-thin pointer-events-auto select-none"
        style="height: 324px;"
      >
        <style>
          /* Scoped hover cancel overlay */
          nuke-tracker-panel .bomb-btn.can-cancel:hover::after {
            content: "✕";
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ef4444; /* red-500 */
            font-weight: 700; /* bold */
            font-size: 1.125rem; /* ~text-lg */
            pointer-events: none; /* allow clicks to pass through to the button */
            z-index: 5; /* ensure overlay sits above inner icon */
          }
        </style>
        ${this.outboundBombs.map((bomb) => {
          const color = this.getProgressColor(bomb.progress);
          const pct = Math.max(0, Math.min(100, Math.round(bomb.progress)));
          const pctStr = pct !== undefined ? ` • ${pct}%` : "";
          const radialProgressStyle = `background: conic-gradient(${color} ${pct}%, #374151 0);`;

          return html`
            <div
              class="bomb-btn ${bomb.canCancel
                ? "can-cancel"
                : ""} relative w-8 h-8 rounded-full flex items-center justify-center cursor-pointer pointer-events-auto"
              style="${radialProgressStyle}"
              @mouseenter=${() => this.onBombHover(bomb)}
              @mouseleave=${() => this.onBombHover(null)}
              @click=${() => (bomb.canCancel ? this.onCancelBomb(bomb) : null)}
              title="${this.getBombDisplayName(
                bomb.type,
              )}${pctStr} ${bomb.canCancel
                ? translateText("nuke_tracker.click_to_cancel")
                : translateText("nuke_tracker.cannot_cancel")}"
            >
              <div
                class="w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden"
              >
                <img
                  src=${this.getBombIcon(bomb.type)}
                  alt=""
                  class="w-5 h-5 opacity-90"
                />
              </div>

              ${this.hoveredBomb?.id === bomb.id
                ? html`
                    <div
                      class="absolute top-1/2 right-full -translate-y-1/2 mr-2 bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-50"
                    >
                      ${this.getBombDisplayName(bomb.type)}${pctStr}
                    </div>
                  `
                : ""}
            </div>
          `;
        })}
      </div>
    `;
  }
}
