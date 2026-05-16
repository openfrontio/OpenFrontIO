/**
 * StructureIconsLayer — now just the build ghost + click-to-build flow.
 *
 * Structure icons themselves are rendered by the WebGL StructurePass; this
 * layer keeps the Pixi-based ghost preview (translucent outline at the cursor,
 * range circle, price tag) and the build/upgrade event flow.
 */

import { extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";
import { OutlineFilter } from "pixi-filters";
import * as PIXI from "pixi.js";
import { Theme } from "src/core/configuration/Theme";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { wouldNukeBreakAlliance } from "../../../core/execution/Util";
import {
  BuildableUnit,
  PlayerBuildableUnitType,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import {
  ConfirmGhostStructureEvent,
  GhostStructureChangedEvent,
  MouseMoveEvent,
  MouseUpEvent,
} from "../../InputHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import { renderNumber } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import {
  ICON_SCALE_FACTOR_ZOOMED_IN,
  ICON_SCALE_FACTOR_ZOOMED_OUT,
  SpriteFactory,
  ZOOM_THRESHOLD,
} from "./StructureDrawingUtils";
const bitmapFont = assetUrl("fonts/round_6x6_modified.xml");

/** True for nuke types (AtomBomb, HydrogenBomb): ghost is preserved after placement so user can place multiple or keep selection (Enter/key confirm). */
export function shouldPreserveGhostAfterBuild(unitType: UnitType): boolean {
  return unitType === UnitType.AtomBomb || unitType === UnitType.HydrogenBomb;
}

extend([a11yPlugin]);

export class StructureIconsLayer implements Layer {
  private ghostUnit: {
    container: PIXI.Container;
    priceText: PIXI.BitmapText;
    priceBg: PIXI.Graphics;
    priceGroup: PIXI.Container;
    priceBox: { height: number; y: number; paddingX: number; minWidth: number };
    range: PIXI.Container | null;
    rangeLevel?: number;
    targetingAlly?: boolean;
    buildableUnit: BuildableUnit;
  } | null = null;
  private pixicanvas: HTMLCanvasElement;
  private ghostStage: PIXI.Container;
  private rootStage: PIXI.Container = new PIXI.Container();
  private readonly theme: Theme;
  private renderer: PIXI.Renderer | null = null;
  private rendererInitialized: boolean = false;
  private readonly connectedAllySmallIds: Set<number> = new Set();
  private readonly mousePos = { x: 0, y: 0 };
  private factory: SpriteFactory;
  private lastGhostQueryAt: number = 0;
  private pendingConfirm: MouseUpEvent | null = null;
  private rebuildPending = false;
  private filterRedArray: OutlineFilter[] = [];

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    public uiState: UIState,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.factory = new SpriteFactory(this.theme, game, transformHandler, true);
  }

  async setupRenderer() {
    if (this.renderer) {
      this.renderer.destroy(true);
      this.rootStage.removeChildren();
    }

    try {
      await PIXI.Assets.load(bitmapFont);
    } catch (error) {
      console.error("Failed to load bitmap font:", error);
    }

    this.pixicanvas = document.createElement("canvas");
    this.pixicanvas.width = window.innerWidth;
    this.pixicanvas.height = window.innerHeight;

    const renderer = await PIXI.autoDetectRenderer({
      canvas: this.pixicanvas,
      resolution: 1,
      width: this.pixicanvas.width,
      height: this.pixicanvas.height,
      antialias: false,
      clearBeforeRender: true,
      backgroundAlpha: 0,
      backgroundColor: 0x00000000,
    });

    console.info(`Using ${renderer.name} for build ghost layer`);

    this.ghostStage = new PIXI.Container();
    this.ghostStage.position.set(0, 0);
    this.ghostStage.setSize(this.pixicanvas.width, this.pixicanvas.height);

    this.rootStage.addChild(this.ghostStage);
    this.rootStage.position.set(0, 0);
    this.rootStage.setSize(this.pixicanvas.width, this.pixicanvas.height);

    this.filterRedArray = [
      new OutlineFilter({ thickness: 2, color: "rgba(255, 0, 0, 1)" }),
    ];

    this.renderer = renderer;

    if (this.renderer.name === "webgpu") {
      // Listen to device loss as PixiJS doesn't handle WebGPU context loss itself
      const gpuRenderer = this.renderer as PIXI.WebGPURenderer;
      gpuRenderer.gpu.device.lost.then(() => {
        this.redraw();
      });
    }

    if (this.renderer.name === "webgl") {
      this.renderer.runners.contextChange.add({
        contextChange: () => {
          requestAnimationFrame(() => {
            this.redraw();
          });
        },
      });
    }

    this.rendererInitialized = true;
  }

  shouldTransform(): boolean {
    return false;
  }

  async redraw() {
    if (this.rebuildPending) return;
    if (this.rendererOrGLContextLost()) return;
    this.rebuildPending = true;
    try {
      if (this.renderer?.name === "webgpu") {
        this.rendererInitialized = false;
        await this.setupRenderer();
      }
      this.resizeCanvas();
      this.clearGhostStructure();
    } finally {
      this.rebuildPending = false;
    }
  }

  async init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.moveGhost(e));
    this.eventBus.on(MouseUpEvent, (e) => this.requestConfirmStructure(e));
    this.eventBus.on(ConfirmGhostStructureEvent, () =>
      this.requestConfirmStructure(
        new MouseUpEvent(this.mousePos.x, this.mousePos.y),
      ),
    );

    window.addEventListener("resize", () => this.resizeCanvas());
    await this.setupRenderer();
    this.resizeCanvas();
  }

  private rendererOrGLContextLost(): boolean {
    if (!this.renderer || !this.rendererInitialized) return true;
    if (this.renderer.name === "webgl") {
      return (this.renderer as PIXI.WebGLRenderer).context?.isLost === true;
    }
    return false;
  }

  resizeCanvas() {
    if (this.rendererOrGLContextLost()) return;
    this.pixicanvas.width = window.innerWidth;
    this.pixicanvas.height = window.innerHeight;
    this.renderer?.resize(innerWidth, innerHeight, 1);
  }

  renderLayer(mainContext: CanvasRenderingContext2D) {
    if (this.rendererOrGLContextLost()) return;

    if (this.ghostUnit) {
      if (this.uiState.ghostStructure === null) {
        this.removeGhostStructure();
      } else if (
        this.uiState.ghostStructure !== this.ghostUnit.buildableUnit.type
      ) {
        this.clearGhostStructure();
      }
    } else if (this.uiState.ghostStructure !== null) {
      this.createGhostStructure(this.uiState.ghostStructure);
    }
    this.renderGhost();

    if (this.renderer) {
      this.renderer.render(this.rootStage);
      mainContext.drawImage(this.renderer.canvas, 0, 0);
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
        if (this.ghostUnit?.container) {
          this.ghostUnit.container.filters = [];
        }

        if (!this.ghostUnit) {
          this.pendingConfirm = null;
          return;
        }

        const unit = buildables.find(
          (u) => u.type === this.ghostUnit!.buildableUnit.type,
        );
        const showPrice = this.game.config().userSettings().cursorCostLabel();
        if (!unit) {
          Object.assign(this.ghostUnit.buildableUnit, {
            canBuild: false,
            canUpgrade: false,
          });
          this.updateGhostPrice(0, showPrice);
          this.ghostUnit.container.filters = this.filterRedArray;
          this.pendingConfirm = null;
          return;
        }

        this.ghostUnit.buildableUnit = unit;
        this.updateGhostPrice(unit.cost ?? 0, showPrice);

        const targetLevel = this.resolveGhostRangeLevel(unit);
        this.updateGhostRange(targetLevel, targetingAlly);

        if (unit.canUpgrade) {
          // No overlapping when a structure is upgradable
          this.uiState.overlappingRailroads = [];
          this.uiState.ghostRailPaths = [];
        } else if (unit.canBuild === false) {
          this.ghostUnit.container.filters = this.filterRedArray;
          this.uiState.overlappingRailroads = [];
          this.uiState.ghostRailPaths = [];
        } else {
          this.uiState.overlappingRailroads = unit.overlappingRailroads;
          this.uiState.ghostRailPaths = unit.ghostRailPaths;
        }

        const scale = this.transformHandler.scale;
        const s =
          scale >= ZOOM_THRESHOLD
            ? Math.max(1, scale / ICON_SCALE_FACTOR_ZOOMED_IN)
            : Math.min(1, scale / ICON_SCALE_FACTOR_ZOOMED_OUT);
        this.ghostUnit.container.scale.set(s);
        this.ghostUnit.range?.scale.set(this.transformHandler.scale);

        if (this.pendingConfirm !== null) {
          const ev = this.pendingConfirm;
          this.pendingConfirm = null;
          if (this.isGhostReadyForConfirm()) {
            this.createStructure(ev);
          }
        }
      });
  }

  private updateGhostPrice(cost: bigint | number, showPrice: boolean) {
    if (!this.ghostUnit) return;
    const { priceText, priceBg, priceBox, priceGroup } = this.ghostUnit;
    priceGroup.visible = showPrice;
    if (!showPrice) return;

    priceText.text = renderNumber(cost);
    priceText.position.set(0, priceBox.y);

    const textWidth = priceText.width;
    const boxWidth = Math.max(
      priceBox.minWidth,
      textWidth + priceBox.paddingX * 2,
    );

    priceBg.clear();
    priceBg
      .roundRect(
        -boxWidth / 2,
        priceBox.y - priceBox.height / 2,
        boxWidth,
        priceBox.height,
        4,
      )
      .fill({ color: 0x000000, alpha: 0.65 });
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

    if (!this.ghostUnit) return;
    const local = this.transformHandler.screenToCanvasCoordinates(e.x, e.y);
    this.ghostUnit.container.position.set(local.x, local.y);
    this.ghostUnit.range?.position.set(local.x, local.y);
  }

  private createGhostStructure(type: PlayerBuildableUnitType | null) {
    const player = this.game.myPlayer();
    if (!player) return;
    if (type === null) return;
    const local = this.transformHandler.screenToCanvasCoordinates(
      this.mousePos.x,
      this.mousePos.y,
    );
    const ghost = this.factory.createGhostContainer(
      player,
      this.ghostStage,
      { x: local.x, y: local.y },
      type,
    );
    this.ghostUnit = {
      container: ghost.container,
      priceText: ghost.priceText,
      priceBg: ghost.priceBg,
      priceGroup: ghost.priceGroup,
      priceBox: ghost.priceBox,
      range: null,
      buildableUnit: {
        type,
        canBuild: false,
        canUpgrade: false,
        cost: 0n,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
    };
    const showPrice = this.game.config().userSettings().cursorCostLabel();
    this.updateGhostPrice(0, showPrice);
    const baseLevel = this.resolveGhostRangeLevel(this.ghostUnit.buildableUnit);
    this.updateGhostRange(baseLevel);
  }

  private clearGhostStructure() {
    this.pendingConfirm = null;
    if (this.ghostUnit) {
      this.ghostUnit.container.destroy({ children: true });
      this.ghostUnit.range?.destroy({ children: true });
      this.ghostUnit = null;
    }
    this.uiState.ghostRailPaths = [];
  }

  private removeGhostStructure() {
    this.clearGhostStructure();
    this.uiState.ghostStructure = null;
    this.eventBus.emit(new GhostStructureChangedEvent(null));
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

  private updateGhostRange(level?: number, targetingAlly: boolean = false) {
    if (!this.ghostUnit) return;

    if (
      this.ghostUnit.range &&
      this.ghostUnit.rangeLevel === level &&
      this.ghostUnit.targetingAlly === targetingAlly
    ) {
      return;
    }

    this.ghostUnit.range?.destroy({ children: true });
    this.ghostUnit.range = null;
    this.ghostUnit.rangeLevel = level;
    this.ghostUnit.targetingAlly = targetingAlly;

    const position = this.ghostUnit.container.position;
    const range = this.factory.createRange(
      this.ghostUnit.buildableUnit.type,
      this.ghostStage,
      { x: position.x, y: position.y },
      level,
      targetingAlly,
    );
    if (range) {
      this.ghostUnit.range = range;
    }
  }
}
