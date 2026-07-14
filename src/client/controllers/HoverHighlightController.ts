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
import { Controller } from "../Controller";
import { MouseMoveEvent } from "../InputHandler";
import { MapRenderer } from "../render/gl";
import { OWNER_MASK } from "../render/gl/utils/TileCodec";
import { TransformHandler } from "../TransformHandler";
import { GameView, UnitView } from "../view";
import { UnitType } from "../../core/game/Game";
import { UserSettings } from "../../core/game/UserSettings";

export class HoverHighlightController implements Controller {
  private lastOwnerID = 0;
  private userSettings: UserSettings = new UserSettings();

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private view: MapRenderer,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.onMouseMove(e));
  }

  private onMouseMove(e: MouseMoveEvent): void {
    const world = this.transformHandler.screenToWorldCoordinatesFloat(e.x, e.y);
    this.view.setMouseWorldPos(world.x, world.y);

    const cell = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return

    let ownerID = 0;
    

    const ref = this.game.ref(cell.x, cell.y);
    if (this.game.isLand(ref)) {
      ownerID = this.game.tileState(ref) & OWNER_MASK;
    } else if (this.userSettings.navalHoverHighlight()) {
      const units = this.game
        .units(UnitType.Warship, UnitType.TradeShip, UnitType.TransportShip)
        // Avoid square root for performance; 50px radius = 2500px²
        .filter((u) => this.game.euclideanDistSquared(ref, u.tile()) < 2500)
        .sort((a: UnitView, b: UnitView) => {
          const distA = this.game.euclideanDistSquared(ref, a.tile());
          const distB = this.game.euclideanDistSquared(ref, b.tile());
          return distA - distB;
        });
      
      if (units.length > 0) {
        ownerID = units[0].owner().smallID();
      }
    }
    
    if (ownerID === this.lastOwnerID) return;
    this.lastOwnerID = ownerID;
    this.view.setHighlightOwner(ownerID);
  }
}
