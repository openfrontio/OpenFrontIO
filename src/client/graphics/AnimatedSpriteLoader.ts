import miniBigSmoke from "../../../resources/sprites/bigsmoke.png";
import conquestSword from "../../../resources/sprites/conquestSword.png";
import dust from "../../../resources/sprites/dust.png";
import miniExplosion from "../../../resources/sprites/miniExplosion.png";
import miniFire from "../../../resources/sprites/minifire.png";
import nuke from "../../../resources/sprites/nukeExplosion.png";
import SAMExplosion from "../../../resources/sprites/samExplosion.png";
import sinkingShip from "../../../resources/sprites/sinkingShip.png";
import miniSmoke from "../../../resources/sprites/smoke.png";
import miniSmokeAndFire from "../../../resources/sprites/smokeAndFire.png";
import unitExplosion from "../../../resources/sprites/unitExplosion.png";
import { Theme } from "../../core/configuration/Config";
import { PlayerView } from "../../core/game/GameView";
import { AnimatedSprite } from "./AnimatedSprite";
import { FxType } from "./fx/Fx";
import { colorizeCanvas } from "./SpriteLoader";

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
    frameCount: 6,
    frameDuration: 100,
    frameWidth: 7,
    looping: true,
    originX: 3,
    originY: 11,
    url: miniFire,
  },
  [FxType.MiniSmoke]: {
    frameCount: 4,
    frameDuration: 120,
    frameWidth: 11,
    looping: true,
    originX: 2,
    originY: 10,
    url: miniSmoke,
  },
  [FxType.MiniBigSmoke]: {
    frameCount: 5,
    frameDuration: 120,
    frameWidth: 24,
    looping: true,
    originX: 9,
    originY: 14,
    url: miniBigSmoke,
  },
  [FxType.MiniSmokeAndFire]: {
    frameCount: 5,
    frameDuration: 120,
    frameWidth: 24,
    looping: true,
    originX: 9,
    originY: 14,
    url: miniSmokeAndFire,
  },
  [FxType.MiniExplosion]: {
    frameCount: 4,
    frameDuration: 70,
    frameWidth: 13,
    looping: false,
    originX: 6,
    originY: 6,
    url: miniExplosion,
  },
  [FxType.Dust]: {
    frameCount: 3,
    frameDuration: 100,
    frameWidth: 9,
    looping: false,
    originX: 4,
    originY: 5,
    url: dust,
  },
  [FxType.UnitExplosion]: {
    frameCount: 4,
    frameDuration: 70,
    frameWidth: 19,
    looping: false,
    originX: 9,
    originY: 9,
    url: unitExplosion,
  },
  [FxType.SinkingShip]: {
    frameCount: 14,
    frameDuration: 90,
    frameWidth: 16,
    looping: false,
    originX: 7,
    originY: 7,
    url: sinkingShip,
  },
  [FxType.Nuke]: {
    frameCount: 9,
    frameDuration: 70,
    frameWidth: 60,
    looping: false,
    originX: 30,
    originY: 30,
    url: nuke,
  },
  [FxType.SAMExplosion]: {
    frameCount: 9,
    frameDuration: 70,
    frameWidth: 48,
    looping: false,
    originX: 23,
    originY: 19,
    url: SAMExplosion,
  },
  [FxType.Conquest]: {
    frameCount: 10,
    frameDuration: 90,
    frameWidth: 21,
    looping: false,
    originX: 10,
    originY: 16,
    url: conquestSword,
  },
};

export class AnimatedSpriteLoader {
  private readonly animatedSpriteImageMap: Map<FxType, HTMLCanvasElement> =
    new Map();
  // Do not color the same sprite twice
  private readonly coloredAnimatedSpriteCache: Map<string, HTMLCanvasElement> =
    new Map();

  public async loadAllAnimatedSpriteImages(): Promise<void> {
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
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("2D context not supported");
          ctx.drawImage(img, 0, 0);

          this.animatedSpriteImageMap.set(typedFxType, canvas);
        } catch (err) {
          console.error(`Failed to load sprite for ${typedFxType}:`, err);
        }
      }),
    );
  }

  private createRegularAnimatedSprite(fxType: FxType): AnimatedSprite | null {
    const config = ANIMATED_SPRITE_CONFIG[fxType];
    const image = this.animatedSpriteImageMap.get(fxType);
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
  }

  private getColoredAnimatedSprite(
    owner: PlayerView,
    fxType: FxType,
    theme: Theme,
  ): HTMLCanvasElement | null {
    const baseImage = this.animatedSpriteImageMap.get(fxType);
    const config = ANIMATED_SPRITE_CONFIG[fxType];
    if (!baseImage || !config) return null;
    const territoryColor = theme.territoryColor(owner);
    const borderColor = theme.borderColor(owner);
    const spawnHighlightColor = theme.spawnHighlightColor();
    const key = `${fxType}-${owner.id()}`;
    let coloredCanvas = this.coloredAnimatedSpriteCache.get(key);
    if (coloredCanvas === undefined) {
      coloredCanvas = colorizeCanvas(
        baseImage,
        territoryColor,
        borderColor,
        spawnHighlightColor,
      );

      this.coloredAnimatedSpriteCache.set(key, coloredCanvas);
    }
    return coloredCanvas;
  }

  private createColoredAnimatedSpriteForUnit(
    fxType: FxType,
    owner: PlayerView,
    theme: Theme,
  ): AnimatedSprite | null {
    const config = ANIMATED_SPRITE_CONFIG[fxType];
    const image = this.getColoredAnimatedSprite(owner, fxType, theme);
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
  }

  public createAnimatedSprite(
    fxType: FxType,
    owner?: PlayerView,
    theme?: Theme,
  ): AnimatedSprite | null {
    if (owner && theme) {
      return this.createColoredAnimatedSpriteForUnit(fxType, owner, theme);
    }
    return this.createRegularAnimatedSprite(fxType);
  }
}
