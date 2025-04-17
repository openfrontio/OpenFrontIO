import { Colord } from "colord";
import atomBombSprite from "../../../resources/sprites/atombomb.png";
import hydrogenBombSprite from "../../../resources/sprites/hydrogenbomb.png";
import mirvSprite from "../../../resources/sprites/mirv2.png";
import samMissileSprite from "../../../resources/sprites/samMissile.png";
import tradeShipSprite from "../../../resources/sprites/tradeship.png";
import transportShipSprite from "../../../resources/sprites/transportship.png";
import warshipSprite from "../../../resources/sprites/warship.png";
import { Theme } from "../../core/configuration/Config";
import { UnitType } from "../../core/game/Game";
import { UnitView } from "../../core/game/GameView";

const SPRITE_CONFIG: Partial<Record<UnitType, string>> = {
  [UnitType.TransportShip]: transportShipSprite,
  [UnitType.Warship]: warshipSprite,
  [UnitType.SAMMissile]: samMissileSprite,
  [UnitType.AtomBomb]: atomBombSprite,
  [UnitType.HydrogenBomb]: hydrogenBombSprite,
  [UnitType.TradeShip]: tradeShipSprite,
  [UnitType.MIRV]: mirvSprite,
};

const spriteMap: Map<UnitType, ImageBitmap> = new Map();

// preload all images
export const loadAllSprites = async (): Promise<void> => {
  const entries = Object.entries(SPRITE_CONFIG);
  const totalSprites = entries.length;
  let loadedCount = 0;

  await Promise.all(
    entries.map(async ([unitType, url]) => {
      const typedUnitType = unitType as UnitType;

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

const getSpriteForUnit = (unitType: UnitType): ImageBitmap | null => {
  return spriteMap.get(unitType) ?? null;
};

export const isSpriteReady = (unitType: UnitType): boolean => {
  return spriteMap.has(unitType);
};

const coloredSpriteCache: Map<string, HTMLCanvasElement> = new Map();

// puts the sprite in an canvas colors it and caches the colored canvas
export const getColoredSprite = (
  unit: UnitView,
  theme: Theme,
  customTerritoryColor?: Colord,
  customBorderColor?: Colord,
): HTMLCanvasElement => {
  const owner = unit.owner();
  const territoryColor = customTerritoryColor ?? theme.territoryColor(owner);
  const borderColor = customBorderColor ?? theme.borderColor(owner);
  const spawnHighlightColor = theme.spawnHighlightColor();
  const colorKey = customTerritoryColor
    ? customTerritoryColor.toRgbString()
    : "";
  const key = owner.id() + unit.type() + colorKey;

  if (coloredSpriteCache.has(key)) {
    return coloredSpriteCache.get(key)!;
  }

  const sprite = getSpriteForUnit(unit.type());

  const territoryRgb = territoryColor.toRgb();
  const borderRgb = borderColor.toRgb();
  const spawnHighlightRgb = spawnHighlightColor.toRgb();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  canvas.width = sprite.width;
  canvas.height = sprite.height;

  ctx.drawImage(sprite, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (r === 180 && g === 180 && b === 180) {
      data[i] = territoryRgb.r;
      data[i + 1] = territoryRgb.g;
      data[i + 2] = territoryRgb.b;
    }

    if (r === 70 && g === 70 && b === 70) {
      data[i] = borderRgb.r;
      data[i + 1] = borderRgb.g;
      data[i + 2] = borderRgb.b;
    }

    if (r === 130 && g === 130 && b === 130) {
      data[i] = spawnHighlightRgb.r;
      data[i + 1] = spawnHighlightRgb.g;
      data[i + 2] = spawnHighlightRgb.b;
    }
  }

  ctx.putImageData(imageData, 0.5, 0.5);
  coloredSpriteCache.set(key, canvas);
  return canvas;
};
