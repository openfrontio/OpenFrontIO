import { Colord } from "colord";
import atomBombSprite from "../../../resources/sprites/atombomb.png";
import cargoPlaneSprite from "../../../resources/sprites/cargoplane.png";
import hydrogenBombSprite from "../../../resources/sprites/hydrogenbomb.png";
import mirvSprite from "../../../resources/sprites/mirv2.png";
import samMissileSprite from "../../../resources/sprites/samMissile.png";
import tradeShipSprite from "../../../resources/sprites/tradeship.png";
import trainCarriageSprite from "../../../resources/sprites/trainCarriage.png";
import trainLoadedCarriageSprite from "../../../resources/sprites/trainCarriageLoaded.png";
import trainEngineSprite from "../../../resources/sprites/trainEngine.png";
import transportShipSprite from "../../../resources/sprites/transportship.png";
import warshipSprite from "../../../resources/sprites/warship.png";
import { Theme } from "../../core/configuration/Config";
import { TrainType, UnitType } from "../../core/game/Game";
import { UnitView } from "../../core/game/GameView";

// Can't reuse TrainType because "loaded" is not a type, just an attribute
const TrainTypeSprite = {
  Engine: "Engine",
  Carriage: "Carriage",
  LoadedCarriage: "LoadedCarriage",
} as const;

type TrainTypeSprite = (typeof TrainTypeSprite)[keyof typeof TrainTypeSprite];

const SPRITE_CONFIG: Partial<Record<UnitType | TrainTypeSprite, string>> = {
  [UnitType.TransportShip]: transportShipSprite,
  [UnitType.Warship]: warshipSprite,
  [UnitType.SAMMissile]: samMissileSprite,
  [UnitType.AtomBomb]: atomBombSprite,
  [UnitType.HydrogenBomb]: hydrogenBombSprite,
  [UnitType.TradeShip]: tradeShipSprite,
  [UnitType.MIRV]: mirvSprite,
  [UnitType.CargoPlane]: cargoPlaneSprite,
  [TrainTypeSprite.Engine]: trainEngineSprite,
  [TrainTypeSprite.Carriage]: trainCarriageSprite,
  [TrainTypeSprite.LoadedCarriage]: trainLoadedCarriageSprite,
};

const spriteMap: Map<UnitType | TrainTypeSprite, ImageBitmap> = new Map();

// preload all images
export const loadAllSprites = async (): Promise<void> => {
  const entries = Object.entries(SPRITE_CONFIG);
  const totalSprites = entries.length;
  let loadedCount = 0;

  await Promise.all(
    entries.map(async ([unitType, url]) => {
      const typedUnitType = unitType as UnitType | TrainTypeSprite;

      if (!url || url === "") {
        console.warn(`No sprite URL for ${typedUnitType}, skipping...`);
        return;
      }

      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;

        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = (err) => reject(err);
        });

        const bitmap = await createImageBitmap(img);
        spriteMap.set(typedUnitType, bitmap);
        loadedCount++;

        if (loadedCount === totalSprites) {
          console.log("All sprites loaded.");
        }
      } catch (err) {
        console.error(`Failed to load sprite for ${typedUnitType}:`, err);
      }
    }),
  );
};

/**
 * The train sprites rely on the train attributes and not only on its type
 */
function trainTypeToSpriteType(unit: UnitView): TrainTypeSprite {
  return unit.trainType() === TrainType.Engine
    ? TrainTypeSprite.Engine
    : unit.isLoaded()
      ? TrainTypeSprite.LoadedCarriage
      : TrainTypeSprite.Carriage;
}

const getSpriteForUnit = (unit: UnitView): ImageBitmap | null => {
  const unitType = unit.type();
  if (unitType === UnitType.Train) {
    const trainType = trainTypeToSpriteType(unit);
    return spriteMap.get(trainType) ?? null;
  }
  return spriteMap.get(unitType) ?? null;
};

export const isSpriteReady = (unit: UnitView): boolean => {
  const unitType = unit.type();
  if (unitType === UnitType.Train) {
    const trainType = trainTypeToSpriteType(unit);
    return spriteMap.has(trainType);
  }
  return spriteMap.has(unitType);
};

const coloredSpriteCache: Map<string, HTMLCanvasElement> = new Map();

/**
 * Load a canvas and replace grayscale with border colors
 */
export const colorizeCanvas = (
  source: CanvasImageSource & { width: number; height: number },
  colorA: Colord,
  colorB: Colord,
  colorC: Colord,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const colorARgb = colorA.toRgb();
  const colorBRgb = colorB.toRgb();
  const colorCRgb = colorC.toRgb();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];

    if (r === 180 && g === 180 && b === 180) {
      data[i] = colorARgb.r;
      data[i + 1] = colorARgb.g;
      data[i + 2] = colorARgb.b;
    } else if (r === 70 && g === 70 && b === 70) {
      data[i] = colorBRgb.r;
      data[i + 1] = colorBRgb.g;
      data[i + 2] = colorBRgb.b;
    } else if (r === 130 && g === 130 && b === 130) {
      data[i] = colorCRgb.r;
      data[i + 1] = colorCRgb.g;
      data[i + 2] = colorCRgb.b;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

function computeSpriteKey(
  unit: UnitView,
  territoryColor: Colord,
  borderColor: Colord,
): string {
  const owner = unit.owner();
  const type = `${unit.type()}-${unit.trainType()}-${unit.isLoaded()}`;
  const key = `${type}-${owner.id()}-${territoryColor.toRgbString()}-${borderColor.toRgbString()}`;
  return key;
}

export const getColoredSprite = (
  unit: UnitView,
  theme: Theme,
  customTerritoryColor?: Colord,
  customBorderColor?: Colord,
): HTMLCanvasElement => {
  const owner = unit.owner();
  const territoryColor: Colord =
    customTerritoryColor ?? theme.territoryColor(owner);
  const borderColor: Colord = customBorderColor ?? theme.borderColor(owner);
  const spawnHighlightColor = theme.spawnHighlightColor();
  const key = computeSpriteKey(unit, territoryColor, borderColor);
  if (coloredSpriteCache.has(key)) {
    return coloredSpriteCache.get(key)!;
  }

  const sprite = getSpriteForUnit(unit);
  if (sprite === null) {
    throw new Error(`Failed to load sprite for ${unit.type()}`);
  }

  const coloredCanvas = colorizeCanvas(
    sprite,
    territoryColor,
    borderColor,
    spawnHighlightColor,
  );

  coloredSpriteCache.set(key, coloredCanvas);
  return coloredCanvas;
};
