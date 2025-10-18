import * as PIXI from "pixi.js";
import { Theme } from "../../../core/configuration/Config";
import { Cell, UnitType } from "../../../core/game/Game";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { TransformHandler } from "../TransformHandler";

import anchorIcon from "../../../../resources/images/AnchorIcon.png";
import cityIcon from "../../../../resources/images/CityIcon.png";
import factoryIcon from "../../../../resources/images/FactoryUnit.png";
import missileSiloIcon from "../../../../resources/images/MissileSiloUnit.png";
import SAMMissileIcon from "../../../../resources/images/SamLauncherUnit.png";
import shieldIcon from "../../../../resources/images/ShieldIcon.png";

export const STRUCTURE_SHAPES: Partial<Record<UnitType, ShapeType>> = {
  [UnitType.City]: "circle",
  [UnitType.Port]: "pentagon",
  [UnitType.Factory]: "circle",
  [UnitType.DefensePost]: "octagon",
  [UnitType.SAMLauncher]: "square",
  [UnitType.MissileSilo]: "triangle",
  [UnitType.Warship]: "cross",
  [UnitType.AtomBomb]: "cross",
  [UnitType.HydrogenBomb]: "cross",
  [UnitType.MIRV]: "cross",
};
export const LEVEL_SCALE_FACTOR = 3;
export const ICON_SCALE_FACTOR_ZOOMED_IN = 3.5;
export const ICON_SCALE_FACTOR_ZOOMED_OUT = 1.4;
export const DOTS_ZOOM_THRESHOLD = 0.5;
export const ZOOM_THRESHOLD = 4.3;
export const ICON_SIZE = {
  circle: 28,
  octagon: 28,
  pentagon: 30,
  square: 28,
  triangle: 28,
  cross: 20,
};
export const OFFSET_ZOOM_Y = 4;

export type ShapeType =
  | "triangle"
  | "square"
  | "pentagon"
  | "octagon"
  | "circle"
  | "cross";

export class SpriteFactory {
  private theme: Theme;
  private game: GameView;
  private transformHandler: TransformHandler;
  private renderSprites: boolean;
  private readonly textureCache: Map<string, PIXI.Texture> = new Map();

  private readonly structuresInfos: Map<
    UnitType,
    { iconPath: string; image: HTMLImageElement | null }
  > = new Map([
    [UnitType.City, { iconPath: cityIcon, image: null }],
    [UnitType.Factory, { iconPath: factoryIcon, image: null }],
    [UnitType.DefensePost, { iconPath: shieldIcon, image: null }],
    [UnitType.Port, { iconPath: anchorIcon, image: null }],
    [UnitType.MissileSilo, { iconPath: missileSiloIcon, image: null }],
    [UnitType.SAMLauncher, { iconPath: SAMMissileIcon, image: null }],
  ]);
  constructor(
    theme: Theme,
    game: GameView,
    transformHandler: TransformHandler,
    renderSprites: boolean,
  ) {
    this.theme = theme;
    this.game = game;
    this.transformHandler = transformHandler;
    this.renderSprites = renderSprites;
    this.structuresInfos.forEach((u, unitType) => this.loadIcon(u, unitType));
  }

  private loadIcon(
    unitInfo: {
      iconPath: string;
      image: HTMLImageElement | null;
    },
    unitType: UnitType,
  ) {
    const image = new Image();
    image.src = unitInfo.iconPath;
    image.onload = () => {
      unitInfo.image = image;
      this.invalidateTextureCache(unitType);
    };
    image.onerror = () => {
      console.error(
        `Failed to load icon for ${unitType}: ${unitInfo.iconPath}`,
      );
    };
  }

  private invalidateTextureCache(unitType: UnitType) {
    for (const key of Array.from(this.textureCache.keys())) {
      if (key.includes(`-${unitType}`)) {
        this.textureCache.delete(key);
      }
    }
  }

  createGhostContainer(
    player: PlayerView,
    ghostStage: PIXI.Container,
    pos: { x: number; y: number },
    structureType: UnitType,
  ): PIXI.Container {
    const parentContainer = new PIXI.Container();
    const texture = this.createTexture(
      structureType,
      player,
      false,
      false,
      true,
    );
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.alpha = 0.5;
    parentContainer.addChild(sprite);
    parentContainer.position.set(pos.x, pos.y);
    parentContainer.scale.set(
      Math.min(1, this.transformHandler.scale / ICON_SCALE_FACTOR_ZOOMED_OUT),
    );
    ghostStage.addChild(parentContainer);
    return parentContainer;
  }

  // --- internal helpers ---

  public createUnitContainer(
    unit: UnitView,
    options: { type?: "icon" | "dot" | "level"; stage: PIXI.Container },
  ): PIXI.Container {
    const parentContainer = new PIXI.Container();
    const tile = unit.tile();
    const worldPos = new Cell(this.game.x(tile), this.game.y(tile));
    const screenPos = this.transformHandler.worldToScreenCoordinates(worldPos);

    const isMarkedForDeletion = unit.markedForDeletion() !== false;
    const isConstruction = unit.type() === UnitType.Construction;
    const constructionType = unit.constructionType();
    const structureType = isConstruction ? constructionType! : unit.type();
    const { type, stage } = options;
    const { scale } = this.transformHandler;

    if (type === "icon" || type === "dot") {
      if (isConstruction && constructionType === undefined) {
        console.warn(
          `Unit ${unit.id()} is a construction but has no construction type.`,
        );
        return parentContainer;
      }
      const texture = this.createTexture(
        structureType,
        unit.owner(),
        isConstruction,
        isMarkedForDeletion,
        type === "icon",
      );
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5);
      parentContainer.addChild(sprite);
    }

    if ((type === "icon" || type === "level") && unit.level() > 1) {
      const text = new PIXI.BitmapText({
        text: unit.level().toString(),
        style: { fontFamily: "round_6x6_modified", fontSize: 14 },
      });
      text.anchor.set(0.5);

      const shape = STRUCTURE_SHAPES[structureType];
      if (shape !== undefined) {
        text.position.y = Math.round(-ICON_SIZE[shape] / 2 - 2);
      }
      parentContainer.addChild(text);
    }

    const posX = Math.round(screenPos.x);
    let posY = Math.round(screenPos.y);
    if (type === "level" && scale >= ZOOM_THRESHOLD && this.renderSprites) {
      posY = Math.round(screenPos.y - scale * OFFSET_ZOOM_Y);
    }
    parentContainer.position.set(posX, posY);

    if (type === "icon") {
      const s =
        scale >= ZOOM_THRESHOLD && !this.renderSprites
          ? Math.max(1, scale / ICON_SCALE_FACTOR_ZOOMED_IN)
          : Math.min(1, scale / ICON_SCALE_FACTOR_ZOOMED_OUT);
      parentContainer.scale.set(s);
    } else if (type === "level") {
      parentContainer.scale.set(Math.max(1, scale / LEVEL_SCALE_FACTOR));
    }

    stage.addChild(parentContainer);
    return parentContainer;
  }

  private createTexture(
    type: UnitType,
    owner: PlayerView,
    isConstruction: boolean,
    isMarkedForDeletion: boolean,
    renderIcon: boolean,
  ): PIXI.Texture {
    const cacheKeyBase = isConstruction
      ? `construction-${type}`
      : `${this.theme.territoryColor(owner).toRgbString()}-${type}`;
    const cacheKey =
      cacheKeyBase +
      (renderIcon ? "-icon" : "") +
      (isMarkedForDeletion ? "-deleted" : "");

    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey)!;
    }
    const shape = STRUCTURE_SHAPES[type];
    const texture = shape
      ? this.createIcon(
          owner,
          type,
          isConstruction,
          isMarkedForDeletion,
          shape,
          renderIcon,
        )
      : PIXI.Texture.EMPTY;
    this.textureCache.set(cacheKey, texture);
    return texture;
  }

  private createIcon(
    owner: PlayerView,
    structureType: UnitType,
    isConstruction: boolean,
    isMarkedForDeletion: boolean,
    shape: string,
    renderIcon: boolean,
  ): PIXI.Texture {
    const structureCanvas = document.createElement("canvas");
    let iconSize = ICON_SIZE[shape];
    if (!renderIcon) {
      iconSize /= 2.5;
    }
    structureCanvas.width = Math.ceil(iconSize);
    structureCanvas.height = Math.ceil(iconSize);
    const context = structureCanvas.getContext("2d")!;

    const tc = owner.territoryColor();
    const bc = owner.borderColor();

    const darker = bc.luminance() < tc.luminance() ? bc : tc;
    const lighter = bc.luminance() < tc.luminance() ? tc : bc;

    let borderColor: string;
    if (isConstruction) {
      context.fillStyle = "rgb(198, 198, 198)";
      borderColor = "rgb(128, 127, 127)";
    } else {
      context.fillStyle = lighter
        .lighten(0.13)
        .alpha(renderIcon ? 0.65 : 1)
        .toRgbString();
      const darken = darker.isLight() ? 0.17 : 0.15;
      borderColor = darker.darken(darken).toRgbString();
    }
    context.strokeStyle = borderColor;
    context.lineWidth = 1;
    const halfIconSize = iconSize / 2;

    switch (shape) {
      case "triangle":
        context.beginPath();
        context.moveTo(halfIconSize, 1); // Top
        context.lineTo(iconSize - 1, iconSize - 1); // Bottom right
        context.lineTo(0, iconSize - 1); // Bottom left
        context.closePath();
        context.fill();
        context.stroke();
        break;

      case "square":
        context.fillRect(1, 1, iconSize - 2, iconSize - 2);
        context.strokeRect(1, 1, iconSize - 3, iconSize - 3);
        break;

      case "octagon":
        {
          const cx = halfIconSize;
          const cy = halfIconSize;
          const r = halfIconSize - 1;
          const step = (Math.PI * 2) / 8;

          context.beginPath();
          for (let i = 0; i < 8; i++) {
            const angle = step * i - Math.PI / 8; // slight rotation for flat top
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            if (i === 0) {
              context.moveTo(x, y);
            } else {
              context.lineTo(x, y);
            }
          }
          context.closePath();
          context.fill();
          context.stroke();
        }
        break;
      case "pentagon":
        {
          const cx = halfIconSize;
          const cy = halfIconSize;
          const r = halfIconSize - 1;
          const step = (Math.PI * 2) / 5;

          context.beginPath();
          for (let i = 0; i < 5; i++) {
            const angle = step * i - Math.PI / 2; // rotate to have flat base or point up
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            if (i === 0) {
              context.moveTo(x, y);
            } else {
              context.lineTo(x, y);
            }
          }
          context.closePath();
          context.fill();
          context.stroke();
        }
        break;
      case "cross": {
        context.strokeStyle = "rgba(0, 0, 0, 1)";
        context.fillStyle = "rgba(0, 0, 0, 1)";

        const gap = iconSize * 0.18; // gap at center
        const lineLen = iconSize / 2;
        context.save();
        context.translate(halfIconSize, halfIconSize);
        // Up
        context.beginPath();
        context.moveTo(0, -gap);
        context.lineTo(0, -lineLen);
        context.stroke();
        // Down
        context.beginPath();
        context.moveTo(0, gap);
        context.lineTo(0, lineLen);
        context.stroke();
        // Left
        context.beginPath();
        context.moveTo(-gap, 0);
        context.lineTo(-lineLen, 0);
        context.stroke();
        // Right
        context.beginPath();
        context.moveTo(gap, 0);
        context.lineTo(lineLen, 0);
        context.stroke();
        context.restore();
        break;
      }

      case "circle":
        context.beginPath();
        context.arc(
          halfIconSize,
          halfIconSize,
          halfIconSize - 1,
          0,
          Math.PI * 2,
        );
        context.fill();
        context.stroke();
        break;

      default:
        throw new Error(`Unknown shape: ${shape}`);
    }

    const structureInfo = this.structuresInfos.get(structureType);

    if (structureInfo?.image && renderIcon) {
      const SHAPE_OFFSETS = {
        triangle: [6, 11],
        square: [5, 5],
        octagon: [6, 6],
        pentagon: [7, 7],
        circle: [6, 6],
        cross: [0, 0],
      };
      const [offsetX, offsetY] = SHAPE_OFFSETS[shape] || [0, 0];
      context.drawImage(
        this.getImageColored(structureInfo.image, borderColor),
        offsetX,
        offsetY,
      );
    }

    if (isMarkedForDeletion) {
      context.save();
      context.strokeStyle = "rgba(255, 64, 64, 0.95)";
      context.lineWidth = Math.max(2, Math.round(iconSize * 0.12));
      context.lineCap = "round";
      const padding = Math.max(2, iconSize * 0.12);
      context.beginPath();
      context.moveTo(padding, padding);
      context.lineTo(iconSize - padding, iconSize - padding);
      context.moveTo(iconSize - padding, padding);
      context.lineTo(padding, iconSize - padding);
      context.stroke();
      context.restore();
    }

    return PIXI.Texture.from(structureCanvas);
  }

  public createRange(
    type: UnitType,
    stage: PIXI.Container,
    pos: { x: number; y: number },
  ): PIXI.Container | null {
    if (stage === undefined) throw new Error("Not initialized");
    const parentContainer = new PIXI.Container();
    const circle = new PIXI.Graphics();
    let radius = 0;
    switch (type) {
      case UnitType.SAMLauncher:
        radius = this.game.config().defaultSamRange();
        break;
      case UnitType.Factory:
        radius = this.game.config().trainStationMaxRange();
        break;
      case UnitType.DefensePost:
        radius = this.game.config().defensePostRange();
        break;
      case UnitType.AtomBomb:
        radius = this.game.config().nukeMagnitudes(UnitType.AtomBomb).outer;
        break;
      case UnitType.HydrogenBomb:
        radius = this.game.config().nukeMagnitudes(UnitType.HydrogenBomb).outer;
        break;
      default:
        return null;
    }
    circle
      .circle(0, 0, radius)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.2 });
    parentContainer.addChild(circle);
    parentContainer.position.set(pos.x, pos.y);
    parentContainer.scale.set(this.transformHandler.scale);
    stage.addChild(parentContainer);
    return parentContainer;
  }

  private getImageColored(
    image: HTMLImageElement,
    color: string,
  ): HTMLCanvasElement {
    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = image.width;
    imageCanvas.height = image.height;
    const ctx = imageCanvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(image, 0, 0);
    return imageCanvas;
  }
}
