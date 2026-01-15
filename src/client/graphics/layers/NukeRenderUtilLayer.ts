import type { EventBus } from "../../../core/EventBus";
import { listNukeBreakAlliance } from "../../../core/execution/Util";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import type { GameView } from "../../../core/game/GameView";
import { GhostStructureChangedEvent, MouseMoveEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

/**
 * A fake layer that calculates every shared information
 * for other layers to draw from. Does not draw anything.
 */
export class NukeRenderUtilLayer implements Layer {
  private mousePos = { x: 0, y: 0 };
  private currentGhostStructure: UnitType | null = null;
  private nukeGhostActive = false;
  private targetTile: TileRef;
  // A list of every player that would have their alliance break if nuked.
  // Includes players not currently allied.
  private allianceStressedPlayers = new Set<number>();

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly uiState: UIState,
    private readonly transformHandler: TransformHandler,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => {
      this.mousePos.x = e.x;
      this.mousePos.y = e.y;
    });
    this.eventBus.on(GhostStructureChangedEvent, (e) => {
      this.currentGhostStructure = e.ghostStructure;
      this.nukeGhostActive =
        e.ghostStructure === UnitType.AtomBomb ||
        e.ghostStructure === UnitType.HydrogenBomb;
    });
  }

  tick() {}

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.nukeGhostActive) {
      return;
    }
    // Convert mouse position to world coordinates
    const rect = this.transformHandler.boundingRect();
    if (!rect) {
      return;
    }
    const localX = this.mousePos.x - rect.left;
    const localY = this.mousePos.y - rect.top;
    const worldCoords = this.transformHandler.screenToWorldCoordinates(
      localX,
      localY,
    );
    if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) {
      return;
    }
    this.targetTile = this.game.ref(worldCoords.x, worldCoords.y);

    // Calculate which players are "stressed" by current nuke placement.
    this.allianceStressedPlayers = listNukeBreakAlliance({
      game: this.game,
      targetTile: this.targetTile,
      magnitude: this.game
        .config()
        .nukeMagnitudes(this.uiState.ghostStructure as UnitType),
      allySmallIds: new Set(
        this.game
          .myPlayer()
          ?.allies()
          .map((a) => a.smallID()),
      ),
      threshold: this.game.config().nukeAllianceBreakThreshold(),
    });
  }

  getAllianceStressedPlayers() {
    return this.allianceStressedPlayers;
  }
}
