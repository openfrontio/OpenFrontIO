/**
 * StructureHighlightController — forwards UnitDisplay hover events to the
 * renderer so matching structures glow while others dim.
 *
 * UnitDisplay emits ToggleStructureEvent on @mouseenter / @mouseleave for each
 * unit-type button, with a payload of "production source" types
 * (Warship → [Port], AtomBomb → [MissileSilo, SAMLauncher], building → itself).
 * This controller just plumbs that payload to view.setHighlightStructureTypes;
 * StructurePass + StructureLevelPass already implement the visual highlight.
 */

import { EventBus } from "../../core/EventBus";
import { Controller } from "../Controller";
import { ToggleStructureEvent } from "../InputHandler";
import { MapRenderer } from "../render/gl";

export class StructureHighlightController implements Controller {
  constructor(
    private eventBus: EventBus,
    private view: MapRenderer,
  ) {}

  init() {
    this.eventBus.on(ToggleStructureEvent, (e) =>
      this.view.setHighlightStructureTypes(e.structureTypes),
    );
  }
}
