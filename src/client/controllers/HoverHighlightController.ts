/**
 * HoverHighlightController — pushes the cursor's tile-owner to the WebGL
 * view so the territory + border passes can highlight the hovered player.
 *
 * Replaces the hover path inside the renderer's MapInteraction class (which
 * was bound to the WebGL canvas; that canvas has pointer-events: none in the
 * current input architecture so its listeners never fired). All input flows
 * through InputHandler → MouseMoveEvent on the EventBus, so we just listen.
 *
 * The highlight is deliberately not instant: an owner is only pushed to the
 * view after the cursor has hovered it continuously for
 * `mapOverlay.highlightDelayMs` (see issue #4310). Quickly sweeping the mouse
 * across many territories then never triggers a highlight at all — the
 * previously applied highlight simply holds until a new owner qualifies —
 * which removes the disturbing strobing flicker. Once the delay elapses the
 * renderer fades the highlight in gradually (see Renderer's highlight
 * intensity ramp), so the appearance is progressive rather than a pop.
 */

import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import { Controller } from "../Controller";
import { MouseMoveEvent } from "../InputHandler";
import { MapRenderer } from "../render/gl";
import { OWNER_MASK } from "../render/gl/utils/TileCodec";
import { TransformHandler } from "../TransformHandler";
import { GameView, UnitView } from "../view";

/** Fallback for the settings-driven delay, matching render-settings.json. */
const DEFAULT_HIGHLIGHT_DELAY_MS = 500;

export class HoverHighlightController implements Controller {
  /** Owner currently pushed to the view (0 = no highlight). */
  private lastOwnerID = 0;
  /** Owner the cursor is hovering right now; becomes lastOwnerID once it qualifies. */
  private pendingOwnerID = 0;
  /** performance.now() at which the cursor entered `pendingOwnerID`'s tiles. */
  private pendingSinceMs = 0;
  /** True while `pendingOwnerID` differs from `lastOwnerID` and is waiting out the delay. */
  private hasPending = false;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private view: MapRenderer,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.onMouseMove(e));
  }

  /**
   * Applies the pending highlight once its delay has elapsed. Runs on the
   * controller tick so the highlight still appears when the mouse stops
   * moving (no further MouseMoveEvents arrive while parked).
   */
  tick(): void {
    this.applyPendingIfDue();
  }

  private highlightDelayMs(): number {
    return (
      this.view.getSettings()?.mapOverlay?.highlightDelayMs ??
      DEFAULT_HIGHLIGHT_DELAY_MS
    );
  }

  private navalHighlightEnabled(): boolean {
    return this.view.getSettings().mapOverlay.navalHighlight;
  }

  private onMouseMove(e: MouseMoveEvent): void {
    const world = this.transformHandler.screenToWorldCoordinatesFloat(e.x, e.y);
    this.view.setMouseWorldPos(world.x, world.y);

    const cell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      this.setPendingOwner(0);
      this.applyPendingIfDue();
      return;
    }
    let ownerID = 0;

    const ref = this.game.ref(cell.x, cell.y);
    if (this.game.isLand(ref)) {
      ownerID = this.game.tileState(ref) & OWNER_MASK;
    } else if (this.navalHighlightEnabled()) {
      // Avoid square root for performance; 50 tile radius = 2500 tiles²
      let closestUnit: UnitView | null = null;
      let closestDistSquared = 2500;
      for (const u of this.game.units(
        UnitType.Warship,
        UnitType.TradeShip,
        UnitType.TransportShip,
      )) {
        const distSquared = this.game.euclideanDistSquared(ref, u.tile());
        if (distSquared < closestDistSquared) {
          closestDistSquared = distSquared;
          closestUnit = u;
        }
      }
      if (closestUnit !== null) {
        ownerID = closestUnit.owner().smallID();
      }
    }

    this.setPendingOwner(ownerID);
    this.applyPendingIfDue();
  }

  /**
   * Records the hovered owner. Entering a different owner (re)starts the
   * delay timer; moving within the already-pending owner keeps it running.
   * Hovering the owner that is already highlighted cancels the pending
   * transition instead of resetting its timer, so brief excursions off an
   * applied highlight don't flash it off and back on.
   */
  private setPendingOwner(ownerID: number): void {
    if (ownerID === this.lastOwnerID) {
      this.hasPending = false;
      this.pendingOwnerID = ownerID;
      return;
    }
    if (!this.hasPending || ownerID !== this.pendingOwnerID) {
      this.pendingOwnerID = ownerID;
      this.pendingSinceMs = performance.now();
      this.hasPending = true;
    }
  }

  /** Pushes the pending owner to the view once it has hovered long enough. */
  private applyPendingIfDue(): void {
    if (!this.hasPending) return;
    if (performance.now() - this.pendingSinceMs < this.highlightDelayMs()) {
      return;
    }
    this.lastOwnerID = this.pendingOwnerID;
    this.hasPending = false;
    this.view.setHighlightOwner(this.lastOwnerID);
  }
}
