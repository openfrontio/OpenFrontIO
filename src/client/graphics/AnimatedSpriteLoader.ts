import miniBigSmoke from "../../../resources/sprites/bigsmoke.png";
import miniFire from "../../../resources/sprites/minifire.png";
import nuke from "../../../resources/sprites/nukeExplosion.png";
import SAMExplosion from "../../../resources/sprites/samExplosion.png";
import miniSmoke from "../../../resources/sprites/smoke.png";
import miniSmokeAndFire from "../../../resources/sprites/smokeAndFire.png";
import { AnimatedSprite } from "./AnimatedSprite";
import { FxType } from "./fx/Fx";

type AnimatedSpriteConfig = {
  url: string;
  frameWidth: number;
  frameCount: number;
  frameDuration: number; // ms per frame
  looping?: boolean;
  originX: number;
  originY: number;
};

const ANIMATED_SPRITE_CONFIG: Partial<Record<FxType, AnimatedSpriteConfig>> = {
  [FxType.MiniFire]: {
    url: miniFire,
    frameWidth: 7,
    frameCount: 6,
    frameDuration: 100,
    looping: true,
    originX: 3,
    originY: 11,
  },
  [FxType.MiniSmoke]: {
    url: miniSmoke,
    frameWidth: 11,
    frameCount: 4,
    frameDuration: 120,
    looping: true,
    originX: 2,
    originY: 10,
  },
  [FxType.MiniBigSmoke]: {
    url: miniBigSmoke,
    frameWidth: 24,
    frameCount: 5,
    frameDuration: 120,
    looping: true,
    originX: 9,
    originY: 14,
  },
  [FxType.MiniSmokeAndFire]: {
    url: miniSmokeAndFire,
    frameWidth: 24,
    frameCount: 5,
    frameDuration: 120,
    looping: true,
    originX: 9,
    originY: 14,
  },
  [FxType.Nuke]: {
    url: nuke,
    frameWidth: 60,
    frameCount: 9,
    frameDuration: 70,
    looping: false,
    originX: 30,
    originY: 30,
  },
  [FxType.SAMExplosion]: {
    url: SAMExplosion,
    frameWidth: 48,
    frameCount: 9,
    frameDuration: 70,
    looping: false,
    originX: 23,
    originY: 19,
  },
};

const animatedSpriteImageMap: Map<FxType, CanvasImageSource> = new Map();

export const loadAllAnimatedSpriteImages = async (): Promise<void> => {
  const entries = Object.entries(ANIMATED_SPRITE_CONFIG);

  await Promise.all(
    entries.map(async ([fxType, config]) => {
      const typedFxType = fxType as FxType;
      if (!config?.url) return;

      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = config.url;

        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = (e) => reject(e);
        });

        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d")!.drawImage(img, 0, 0);

        animatedSpriteImageMap.set(typedFxType, canvas);
      } catch (err) {
        console.error(`Failed to load sprite for ${typedFxType}:`, err);
      }
    }),
  );
};

export const createAnimatedSpriteForUnit = (
  fxType: FxType,
): AnimatedSprite | null => {
  const config = ANIMATED_SPRITE_CONFIG[fxType];
  const image = animatedSpriteImageMap.get(fxType);
  if (!config || !image) return null;

  return new AnimatedSprite(
    image,
    config.frameWidth,
    config.frameCount,
    config.frameDuration,
    config.looping ?? true,
    config.originX,
    config.originY,
  );
};
