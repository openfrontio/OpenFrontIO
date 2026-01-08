import type { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import type {
  GameView,
  PlayerView,
  UnitView,
} from "../../../core/game/GameView";
import { ToggleStructureEvent } from "../../InputHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import { computeUncoveredArcIntervals, Interval } from "./utils/circleUnion";

interface SAMRadius {
  x: number;
  y: number;
  r: number;
  owner: PlayerView;
  arcs: Interval[];
}

interface SamInfo {
  ownerId: number;
  level: number;
}
/**
 * Layer responsible for rendering SAM launcher defense radii
 */
export class SAMRadiusLayer implements Layer {
  private readonly samLaunchers: Map<number, SamInfo> = new Map(); // Track SAM launcher IDs -> SAM info
  // track whether the stroke should be shown due to hover or due to an active build ghost
  private hoveredShow: boolean = false;
  private ghostShow: boolean = false;
  private visible: boolean = false;
  private samRanges: SAMRadius[] = [];
  private dashOffset = 0;
  private rotationSpeed = 14; // px per second
  private lastRefresh = Date.now();
  private needsRedraw = false;

  private handleToggleStructure(e: ToggleStructureEvent) {
    const types = e.structureTypes;
    this.hoveredShow = !!types && types.indexOf(UnitType.SAMLauncher) !== -1;
    this.updateVisibility();
  }

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
    private readonly uiState: UIState,
  ) {}

  init() {
    // Listen for game updates to detect SAM launcher changes
    // Also listen for UI toggle structure events so we can show borders when
    // the user is hovering the Atom/Hydrogen option (UnitDisplay emits
    // ToggleStructureEvent with SAMLauncher included in the list).
    this.eventBus.on(ToggleStructureEvent, (e) =>
      this.handleToggleStructure(e),
    );
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    // Check for updates to SAM launchers
    const unitUpdates = this.game.updatesSinceLastTick()?.[GameUpdateType.Unit];
    if (unitUpdates) {
      for (const update of unitUpdates) {
        const unit = this.game.unit(update.id);
        if (unit && unit.type() === UnitType.SAMLauncher) {
          if (this.hasChanged(unit)) {
            this.needsRedraw = true; // A SAM changed: radiuses shall be recomputed when necessary
            break;
          }
        }
      }
    }

    // show when in ghost mode for silo/sam/atom/hydrogen
    this.ghostShow =
      this.uiState.ghostStructure === UnitType.MissileSilo ||
      this.uiState.ghostStructure === UnitType.SAMLauncher ||
      this.uiState.ghostStructure === UnitType.AtomBomb ||
      this.uiState.ghostStructure === UnitType.HydrogenBomb;
    this.updateVisibility();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.visible) {
      if (this.needsRedraw) {
        // SAM changed: the radiuses needs to be updated
        this.computeCircleUnions();
        this.needsRedraw = false;
      }
      this.updateDashAnimation();
      this.drawCirclesUnion(context);
    }
  }

  private updateDashAnimation() {
    const now = Date.now();
    const dt = now - this.lastRefresh;
    this.lastRefresh = now;
    this.dashOffset += (this.rotationSpeed * dt) / 1000;
    if (this.dashOffset > 1e6) this.dashOffset = this.dashOffset % 1000000;
  }

  private updateVisibility() {
    const next = this.hoveredShow || this.ghostShow;
    if (next !== this.visible) {
      this.visible = next;
    }
  }

  private hasChanged(unit: UnitView): boolean {
    const samInfos = this.samLaunchers.get(unit.id());
    const isNew = samInfos === undefined;
    const active = unit.isActive();
    const ownerId = unit.owner().smallID();
    let hasChanges = isNew || !active; // was built or destroyed
    hasChanges ||= !isNew && samInfos.ownerId !== ownerId; // Sam owner changed
    hasChanges ||= !isNew && samInfos.level !== unit.level(); // Sam leveled up
    return hasChanges;
  }

  private getAllSamRanges(): SAMRadius[] {
    // Get all active SAM launchers
    const samLaunchers = this.game
      .units(UnitType.SAMLauncher)
      .filter((unit) => unit.isActive());

    // Update our tracking set
    this.samLaunchers.clear();
    samLaunchers.forEach((sam) =>
      this.samLaunchers.set(sam.id(), {
        ownerId: sam.owner().smallID(),
        level: sam.level(),
      }),
    );

    // Collect radius data
    const radiuses = samLaunchers.map((sam) => {
      const tile = sam.tile();
      return {
        x: this.game.x(tile),
        y: this.game.y(tile),
        r: this.game.config().samRange(sam.level()),
        owner: sam.owner(),
        arcs: [],
      };
    });
    return radiuses;
  }

  private drawArcSegments(ctx: CanvasRenderingContext2D, a: SAMRadius) {
    const outlineColor = "rgba(0, 0, 0, 1)";
    const lineColorSelf = "rgba(0, 255, 0, 1)";
    const lineColorEnemy = "rgba(255, 0, 0, 1)";
    const lineColorFriend = "rgba(255, 255, 0, 1)";
    const extraOutlineWidth = 1; // adds onto below
    const lineWidth = 3;
    const lineDash = [12, 6];

    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;
    for (const [s, e] of a.arcs) {
      // skip tiny arcs
      if (e - s < 1e-3) continue;
      ctx.beginPath();
      ctx.arc(a.x + offsetX, a.y + offsetY, a.r, s, e);

      // Outline
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = lineWidth + extraOutlineWidth;
      ctx.setLineDash([
        lineDash[0] + extraOutlineWidth,
        Math.max(lineDash[1] - extraOutlineWidth, 0),
      ]);
      ctx.lineDashOffset = this.dashOffset + extraOutlineWidth / 2;
      ctx.stroke();

      // Inline
      if (a.owner.isMe()) {
        ctx.strokeStyle = lineColorSelf;
      } else if (this.game.myPlayer()?.isFriendly(a.owner)) {
        ctx.strokeStyle = lineColorFriend;
      } else {
        ctx.strokeStyle = lineColorEnemy;
      }

      ctx.lineWidth = lineWidth;
      ctx.setLineDash(lineDash);
      ctx.lineDashOffset = this.dashOffset;
      ctx.stroke();
    }
  }

  /**
   * Compute for each circle which angular segments are NOT covered by any other circle
   */
  private computeCircleUnions() {
    this.samRanges = this.getAllSamRanges();
    for (let i = 0; i < this.samRanges.length; i++) {
      const a = this.samRanges[i];
      computeUncoveredArcIntervals(
        a,
        this.samRanges,
        (circle, other) => circle.owner.smallID() === other.owner.smallID(),
      );
    }
  }

  /**
   * Draw union of multiple circles: stroke only the outer arcs so overlapping circles appear as one combined shape.
   */
  private drawCirclesUnion(context: CanvasRenderingContext2D) {
    const circles = this.samRanges;
    if (circles.length === 0 || !this.visible) return;
    // Only draw the stroke when UI toggle indicates SAM launchers are focused (e.g. hovering Atom/Hydrogen option).
    context.save();
    for (let i = 0; i < circles.length; i++) {
      this.drawArcSegments(context, circles[i]);
    }
    context.restore();
  }
}
