/**
 * HoverHighlightController — pushes the cursor's tile-owner to the WebGL
 * view so the territory + border passes can highlight the hovered player.
 *
 * Replaces the hover path inside the renderer's MapInteraction class (which
 * was bound to the WebGL canvas; that canvas has pointer-events: none in the
 * current input architecture so its listeners never fired). All input flows
 * through InputHandler → MouseMoveEvent on the EventBus, so we just listen.
 */

import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import { Controller } from "../Controller";
import { MouseMoveEvent } from "../InputHandler";
import { MapRenderer } from "../render/gl";
import { OWNER_MASK } from "../render/gl/utils/TileCodec";
import { TransformHandler } from "../TransformHandler";
import { GameView, UnitView } from "../view";

export class HoverHighlightController implements Controller {
  private lastOwnerID = 0;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private view: MapRenderer,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.onMouseMove(e));
  }

  private navalHighlightEnabled(): boolean {
    return this.view.getSettings().mapOverlay.navalHighlight;
  }

  private onMouseMove(e: MouseMoveEvent): void {
    const world = this.transformHandler.screenToWorldCoordinatesFloat(e.x, e.y);
    this.view.setMouseWorldPos(world.x, world.y);

    const cell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      if (this.lastOwnerID !== 0) {
        this.lastOwnerID = 0;
        this.view.setHighlightOwner(0);
      }
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

    if (ownerID === this.lastOwnerID) return;
    this.lastOwnerID = ownerID;
    this.view.setHighlightOwner(ownerID);
  }
}
