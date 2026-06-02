/**
 * BuildPreviewController — build-ghost state machine + click-to-build flow.
 *
 * All rendering for the build ghost (outline, range circle, rail snap,
 * crosshair) lives in the WebGL renderer. This controller owns the state:
 * it queries buildables for the cursor tile, tracks whether the placement
 * is valid, and pushes preview data straight to the WebGL view.
 */

import { EventBus } from "../../core/EventBus";
import { wouldNukeBreakAlliance } from "../../core/execution/Util";
import {
  BuildableUnit,
  PlayerBuildableUnitType,
  UnitType,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { GameView } from "../../core/game/GameView";
import { UserSettings } from "../../core/game/UserSettings";
import { Controller } from "../Controller";
import {
  ConfirmGhostStructureEvent,
  MouseMoveEvent,
  MouseUpEvent,
} from "../InputHandler";
import { GameView as WebGLGameView, buildNukeTrajectory } from "../render/gl";
import type { SAMInfo } from "../render/gl/utils/NukeTrajectory";
import type { GhostPreviewData } from "../render/types";
import { TransformHandler } from "../TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../Transport";
import { UIState } from "../UIState";

/** True for nuke types (AtomBomb, HydrogenBomb): ghost is preserved after placement so user can place multiple or keep selection (Enter/key confirm). */
export function shouldPreserveGhostAfterBuild(unitType: UnitType): boolean {
  return unitType === UnitType.AtomBomb || unitType === UnitType.HydrogenBomb;
}

export class BuildPreviewController implements Controller {
  /** Current ghost (null when no build type is active). */
  private ghostUnit: { buildableUnit: BuildableUnit } | null = null;
  private readonly connectedAllySmallIds: Set<number> = new Set();
  private readonly mousePos = { x: 0, y: 0 };
  private lastGhostQueryAt: number = 0;
  private pendingConfirm: MouseUpEvent | null = null;

  // Buildable validation runs on the snapped tile under the cursor, but the
  // rendered icon follows the cursor at sub-tile precision so motion is
  // continuous instead of stepping tile-to-tile. cursorLoop re-emits each
  // frame with the current cursor world position.
  private lastGhostData: GhostPreviewData | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    public uiState: UIState,
    private transformHandler: TransformHandler,
    private view: WebGLGameView,
    private userSettings: UserSettings,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.moveGhost(e));
    this.eventBus.on(MouseUpEvent, (e) => this.requestConfirmStructure(e));
    this.eventBus.on(ConfirmGhostStructureEvent, () =>
      this.requestConfirmStructure(
        new MouseUpEvent(this.mousePos.x, this.mousePos.y),
      ),
    );

    // Re-emit the ghost each render frame at the cursor's current world
    // position (sub-tile). Buildable validation still runs on the snapped
    // tile in renderGhost(); this loop just keeps the icon under the cursor
    // so motion is continuous instead of stepping tile-to-tile.
    // The shader treats (tileX + 0.5, tileY + 0.5) as the icon center (so an
    // integer tile coord centers on that tile), so we subtract 0.5 here to
    // place the icon exactly under the cursor.
    const cursorLoop = () => {
      if (this.lastGhostData !== null) {
        const w = this.transformHandler.screenToWorldCoordinatesFloat(
          this.mousePos.x,
          this.mousePos.y,
        );
        this.view.updateGhostPreview({
          ...this.lastGhostData,
          tileX: w.x - 0.5,
          tileY: w.y - 0.5,
        });
      }
      requestAnimationFrame(cursorLoop);
    };
    requestAnimationFrame(cursorLoop);
  }

  tick() {
    // Re-query buildables periodically (world state can change — tiles may
    // become buildable as troops/territory move).
    this.syncGhostState();
    this.renderGhost();
  }

  /**
   * Reconcile our internal ghost state with uiState.ghostStructure. Other
   * UI bits (build menu, key bindings) toggle uiState; we mirror it here.
   */
  private syncGhostState(): void {
    const target = this.uiState.ghostStructure;
    if (this.ghostUnit) {
      if (target === null) {
        this.removeGhostStructure();
      } else if (target !== this.ghostUnit.buildableUnit.type) {
        this.clearGhostStructure();
        this.createGhostStructure(target);
      }
    } else if (target !== null) {
      this.createGhostStructure(target);
    }
  }

  renderGhost() {
    if (!this.ghostUnit) return;

    const now = performance.now();
    if (now - this.lastGhostQueryAt < 50) return;
    this.lastGhostQueryAt = now;
    let tileRef: TileRef | undefined;
    const tile = this.transformHandler.screenToWorldCoordinates(
      this.mousePos.x,
      this.mousePos.y,
    );
    if (this.game.isValidCoord(tile.x, tile.y)) {
      tileRef = this.game.ref(tile.x, tile.y);
    }

    // Check if targeting an ally (for nuke warning visual)
    let targetingAlly = false;
    const myPlayer = this.game.myPlayer();
    const nukeType = this.ghostUnit.buildableUnit.type;
    if (
      tileRef &&
      myPlayer &&
      (nukeType === UnitType.AtomBomb || nukeType === UnitType.HydrogenBomb)
    ) {
      this.connectedAllySmallIds.clear();
      const allies = myPlayer.allies();
      for (let i = 0; i < allies.length; i++) {
        const ally = allies[i];
        if (!ally.isDisconnected()) {
          this.connectedAllySmallIds.add(ally.smallID());
        }
      }

      if (this.connectedAllySmallIds.size > 0) {
        targetingAlly = wouldNukeBreakAlliance({
          game: this.game,
          targetTile: tileRef,
          magnitude: this.game.config().nukeMagnitudes(nukeType),
          allySmallIds: this.connectedAllySmallIds,
          threshold: this.game.config().nukeAllianceBreakThreshold(),
        });
      }
    }

    this.game
      ?.myPlayer()
      ?.buildables(tileRef, [this.ghostUnit?.buildableUnit.type])
      .then((buildables) => {
        if (!this.ghostUnit) {
          this.pendingConfirm = null;
          this.emitGhostPreview(tileRef, targetingAlly);
          return;
        }

        const unit = buildables.find(
          (u) => u.type === this.ghostUnit!.buildableUnit.type,
        );
        if (!unit) {
          Object.assign(this.ghostUnit.buildableUnit, {
            canBuild: false,
            canUpgrade: false,
          });
          this.pendingConfirm = null;
          this.emitGhostPreview(tileRef, targetingAlly);
          return;
        }

        this.ghostUnit.buildableUnit = unit;

        if (this.pendingConfirm !== null) {
          const ev = this.pendingConfirm;
          this.pendingConfirm = null;
          if (this.isGhostReadyForConfirm()) {
            this.createStructure(ev);
          }
        }

        this.emitGhostPreview(tileRef, targetingAlly);
      });
  }

  /**
   * Push a GhostPreviewData snapshot to the WebGL view (StructurePass /
   * RangeCirclePass / RailroadPass / CrosshairPass all read it). null when
   * the ghost can't be placed. smoothLoop interpolates displayed position
   * toward the target tile each frame.
   */
  private emitGhostPreview(
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
  ): void {
    const data = this.buildGhostPreviewData(tileRef, targetingAlly);
    if (data === null) {
      this.lastGhostData = null;
      this.view.updateGhostPreview(null);
    } else {
      this.lastGhostData = data;
    }
    this.updateNukeTrajectoryPreview(tileRef);
  }

  /**
   * For AtomBomb / HydrogenBomb ghosts, push the Bezier trajectory preview
   * (closest player-owned silo → target, accounting for non-allied SAMs).
   * Cleared whenever the ghost isn't a nuke, has no target, or the player
   * has no silos.
   */
  private updateNukeTrajectoryPreview(tileRef: TileRef | undefined): void {
    if (!this.ghostUnit || tileRef === undefined) {
      this.view.updateNukeTrajectory(null);
      return;
    }
    const type = this.ghostUnit.buildableUnit.type;
    if (type !== UnitType.AtomBomb && type !== UnitType.HydrogenBomb) {
      this.view.updateNukeTrajectory(null);
      return;
    }
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      this.view.updateNukeTrajectory(null);
      return;
    }

    const silos = myPlayer
      .units(UnitType.MissileSilo)
      .filter((u) => u.isActive());
    if (silos.length === 0) {
      this.view.updateNukeTrajectory(null);
      return;
    }

    const dstX = this.game.x(tileRef);
    const dstY = this.game.y(tileRef);
    let bestSilo = silos[0];
    let bestDistSq = Infinity;
    for (const s of silos) {
      const sx = this.game.x(s.tile());
      const sy = this.game.y(s.tile());
      const dx = sx - dstX;
      const dy = sy - dstY;
      const d = dx * dx + dy * dy;
      if (d < bestDistSq) {
        bestDistSq = d;
        bestSilo = s;
      }
    }
    const srcX = this.game.x(bestSilo.tile());
    const srcY = this.game.y(bestSilo.tile());

    // Non-allied SAMs threaten the trajectory; own + allied SAMs don't.
    const allyIds = new Set<number>();
    for (const a of myPlayer.allies()) allyIds.add(a.smallID());
    const sams: SAMInfo[] = [];
    for (const s of this.game.units(UnitType.SAMLauncher)) {
      if (!s.isActive()) continue;
      const owner = s.owner();
      if (owner === myPlayer) continue;
      if (allyIds.has(owner.smallID())) continue;
      const r = this.game.config().samRange(s.level());
      sams.push({
        x: this.game.x(s.tile()),
        y: this.game.y(s.tile()),
        rangeSq: r * r,
      });
    }

    this.view.updateNukeTrajectory(
      buildNukeTrajectory(
        srcX,
        srcY,
        dstX,
        dstY,
        this.game.height(),
        this.uiState.rocketDirectionUp,
        sams,
      ),
    );
  }

  private buildGhostPreviewData(
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
  ): GhostPreviewData | null {
    if (!this.ghostUnit) return null;
    if (tileRef === undefined) return null;
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return null;

    const u = this.ghostUnit.buildableUnit;

    // Upgrade-target tile — only when upgrading an existing unit.
    let upgradeTargetTile: number | null = null;
    if (u.canUpgrade !== false) {
      upgradeTargetTile = this.game.unit(u.canUpgrade)?.tile() ?? null;
    }

    // Range circle: SAM placement preview shows targetable radius; nuke
    // previews show the outer blast radius at the target tile.
    let rangeRadius = 0;
    switch (u.type) {
      case UnitType.SAMLauncher: {
        const level = this.resolveGhostRangeLevel(u) ?? 1;
        rangeRadius = this.game.config().samRange(level);
        break;
      }
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        rangeRadius = this.game.config().nukeMagnitudes(u.type).outer;
        break;
      case UnitType.Factory:
        rangeRadius = this.game.config().trainStationMaxRange();
        break;
      case UnitType.DefensePost:
        rangeRadius = this.game.config().defensePostRange();
        break;
    }

    const cost = u.cost;
    return {
      ghostType: u.type,
      tileX: this.game.x(tileRef),
      tileY: this.game.y(tileRef),
      canBuild: u.canBuild !== false,
      canUpgrade: u.canUpgrade !== false,
      cost: Number(cost),
      showCost: this.userSettings.cursorCostLabel(),
      canAfford: myPlayer.gold() >= cost,
      ghostRailPaths: u.ghostRailPaths,
      overlappingRailroads: u.overlappingRailroads,
      ownerID: myPlayer.smallID(),
      upgradeTargetTile,
      rangeRadius,
      rangeWarning: targetingAlly,
    };
  }

  private isGhostReadyForConfirm(): boolean {
    if (!this.ghostUnit) return false;
    const bu = this.ghostUnit.buildableUnit;
    return bu.canBuild !== false || bu.canUpgrade !== false;
  }

  private requestConfirmStructure(e: MouseUpEvent): void {
    if (!this.ghostUnit && !this.uiState.ghostStructure) return;
    if (this.isGhostReadyForConfirm()) {
      this.createStructure(e);
    } else {
      this.pendingConfirm = e;
    }
  }

  private createStructure(e: MouseUpEvent) {
    if (!this.ghostUnit) return;
    if (
      this.ghostUnit.buildableUnit.canBuild === false &&
      this.ghostUnit.buildableUnit.canUpgrade === false
    ) {
      this.removeGhostStructure();
      return;
    }
    const tile = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (this.ghostUnit.buildableUnit.canUpgrade !== false) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          this.ghostUnit.buildableUnit.canUpgrade,
          this.ghostUnit.buildableUnit.type,
        ),
      );
      this.removeGhostStructure();
    } else if (this.ghostUnit.buildableUnit.canBuild) {
      const unitType = this.ghostUnit.buildableUnit.type;
      const rocketDirectionUp =
        unitType === UnitType.AtomBomb || unitType === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;
      this.eventBus.emit(
        new BuildUnitIntentEvent(
          unitType,
          this.game.ref(tile.x, tile.y),
          rocketDirectionUp,
        ),
      );
      if (!shouldPreserveGhostAfterBuild(unitType)) {
        this.removeGhostStructure();
      }
    } else {
      this.removeGhostStructure();
    }
  }

  private moveGhost(e: MouseMoveEvent) {
    this.mousePos.x = e.x;
    this.mousePos.y = e.y;
  }

  private createGhostStructure(type: PlayerBuildableUnitType | null) {
    if (type === null) return;
    if (this.game.myPlayer() === null) return;
    this.ghostUnit = {
      buildableUnit: {
        type,
        canBuild: false,
        canUpgrade: false,
        cost: 0n,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
    };
  }

  private clearGhostStructure() {
    this.pendingConfirm = null;
    this.ghostUnit = null;
    this.lastGhostData = null;
    this.view.updateGhostPreview(null);
    this.view.updateNukeTrajectory(null);
  }

  private removeGhostStructure() {
    this.clearGhostStructure();
    this.uiState.ghostStructure = null;
  }

  private resolveGhostRangeLevel(
    buildableUnit: BuildableUnit,
  ): number | undefined {
    if (buildableUnit.type !== UnitType.SAMLauncher) return undefined;
    if (buildableUnit.canUpgrade !== false) {
      const existing = this.game.unit(buildableUnit.canUpgrade);
      if (existing) {
        return existing.level() + 1;
      } else {
        console.error("Failed to find existing SAMLauncher for upgrade");
      }
    }
    return 1;
  }
}
