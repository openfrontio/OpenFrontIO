import { Theme } from "../../../core/configuration/Config";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

import cityIcon from "../../../../resources/images/CityIconWhite.svg";
import missileSiloIcon from "../../../../resources/images/MissileSiloIconWhite.svg";
import anchorIcon from "../../../../resources/images/PortIcon.svg";
import SAMMissileIcon from "../../../../resources/images/SamLauncherIconWhite.svg";
import shieldIcon from "../../../../resources/images/ShieldIconWhite.svg";
import { Cell, STRUCTURE_TYPES, UnitType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, UnitView } from "../../../core/game/GameView";

class StructureRenderInfo {
  public icons: Map<string, HTMLImageElement> = new Map(); // Track icon elements

  constructor(
    public unit: UnitView,
    public lastRenderCalc: number,
    public location: Cell | null,
    public element: HTMLElement,
  ) {}
}

export class StructureIconsLayer implements Layer {
  private theme: Theme;
  private renders: StructureRenderInfo[] = [];
  public scale: number = 1.8;
  private seenUnits: Set<UnitView> = new Set();
  private container: HTMLDivElement;
  private structures: Map<UnitType, { icon: string; svg: SVGElement | null }> =
    new Map([
      [UnitType.City, { icon: cityIcon, svg: null }],
      [UnitType.DefensePost, { icon: shieldIcon, svg: null }],
      [UnitType.Port, { icon: anchorIcon, svg: null }],
      [UnitType.MissileSilo, { icon: missileSiloIcon, svg: null }],
      [UnitType.SAMLauncher, { icon: SAMMissileIcon, svg: null }],
    ]);

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {
    this.theme = game.config().theme();
    this.structures.forEach((u) => this.loadSVG(u));
  }

  private async loadSVG(unitSVGInfos: {
    icon: string;
    svg: SVGElement | null;
  }) {
    try {
      const response = await fetch(unitSVGInfos.icon);
      if (!response.ok) {
        throw new Error(`Failed to load SVG: ${response.statusText}`);
      }
      unitSVGInfos.svg = this.createSvgElementFromString(await response.text());
    } catch (error) {
      console.error(`Error loading SVG ${unitSVGInfos.icon}:`, error);
      unitSVGInfos.svg = null;
    }
  }

  private createSvgElementFromString(svgStr: string): SVGSVGElement | null {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgStr, "image/svg+xml");
    const el = doc.documentElement;

    if (el instanceof SVGSVGElement) {
      const svgElement = el;
      return svgElement;
    } else {
      throw new Error("Parsed document is not a valid SVG element.");
    }
  }
  shouldTransform(): boolean {
    return false;
  }

  init() {
    this.container = document.createElement("div");
    this.container.style.position = "fixed";
    this.container.style.left = "0";
    this.container.style.top = "0";
    this.container.style.pointerEvents = "none";
    this.container.style.zIndex = "2";
    document.body.appendChild(this.container);
  }

  public tick() {
    for (const unit of this.game.units()) {
      if (
        unit.isActive() &&
        STRUCTURE_TYPES.has(unit.type()) &&
        !this.seenUnits.has(unit)
      ) {
        this.seenUnits.add(unit);
        this.renders.push(
          new StructureRenderInfo(unit, 0, null, this.createUnitElement(unit)),
        );
      }
    }

    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];
    for (const u of unitUpdates) {
      const unit = this.game.unit(u.id);
      if (
        unit === undefined ||
        !this.seenUnits.has(unit) ||
        !STRUCTURE_TYPES.has(unit.type()) ||
        !unit.isActive()
      )
        continue;

      const render = this.renders.find((r) => r.unit === unit);
      if (render) {
        render.element.remove();
        this.seenUnits.delete(render.unit);
        render.element = this.createUnitElement(unit);
      }
    }
  }

  public renderLayer(mainContex: CanvasRenderingContext2D) {
    if (this.transformHandler.scale > 2) {
      this.container.style.display = "none";
      return;
    }
    this.container.style.display = "block";
    for (const render of this.renders) {
      this.renderStructure(render);
    }
  }

  private createUnitElement(unit: UnitView): HTMLDivElement {
    const element = document.createElement("div");
    element.style.position = "absolute";
    element.classList.add("structure-icon");

    const border = document.createElement("div");
    border.style.width = "19px";
    border.style.height = "19px";
    border.style.backgroundColor = this.theme
      .territoryColor(unit.owner())
      .lighten(0.1)
      .toRgbString();
    border.style.borderRadius = "50%";
    border.style.border =
      "1px solid " +
      this.theme.borderColor(unit.owner()).darken(0.1).toRgbString();
    element.appendChild(border);
    const structureInfo = this.structures.get(unit.type());
    if (!structureInfo?.svg) {
      console.warn(`SVG not loaded for unit type: ${unit.type()}`);
      return element;
    }
    const svgElement = structureInfo.svg.cloneNode(true) as SVGElement;
    svgElement.style.width = "13px";
    svgElement.style.height = "13px";
    svgElement.style.position = "relative";
    svgElement.style.top = "2px";
    svgElement.style.left = "2px";

    const paths = svgElement.querySelectorAll("path");
    paths.forEach(
      (path) =>
        (path.style.fill = this.theme
          .borderColor(unit.owner())
          .darken(0.1)
          .toRgbString()),
    );
    border.appendChild(svgElement);
    // Start off invisible so it doesn't flash at 0,0
    element.style.display = "none";

    this.container.appendChild(element);
    return element;
  }

  renderStructure(render: StructureRenderInfo) {
    if (!render.unit.isActive()) {
      this.renders = this.renders.filter((r) => r !== render);
      this.seenUnits.delete(render.unit);
      render.element.remove();
      return;
    }

    const oldLocation = render.location;
    const loc = this.transformHandler.worldToScreenCoordinates(
      new Cell(
        this.game.x(render.unit.tile()),
        this.game.y(render.unit.tile()),
      ),
    );

    // Screen space calculations
    const size = this.transformHandler.scale;
    loc.y -= size * 7;

    render.location = new Cell(loc.x, loc.y);
    const canvasRect = this.transformHandler.boundingRect();
    if (
      render.location.x < canvasRect.left ||
      render.location.y < canvasRect.top ||
      render.location.x > canvasRect.right ||
      render.location.y > canvasRect.bottom
    ) {
      render.element.style.display = "none";
      return;
    }

    if (render.location && render.location !== oldLocation) {
      render.element.style.display = "block";
      const scale = Math.min(1, this.transformHandler.scale * 1.3);
      render.element.style.transform = `translate(${render.location.x}px, ${render.location.y}px) translate(-50%, -50%) translate(-5px, 0) scale(${scale})`;
    }
  }
}
