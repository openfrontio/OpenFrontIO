import miniBigSmoke from "../../../resources/sprites/bigsmoke.png";
import buildingExplosion from "../../../resources/sprites/buildingExplosion.png";
import happyElf from "../../../resources/sprites/christmas/happy_elf.png";
import sadElf from "../../../resources/sprites/christmas/sad_elf.png";
import santa from "../../../resources/sprites/christmas/santa.png";
import snowman from "../../../resources/sprites/christmas/snowman.png";
import sparks from "../../../resources/sprites/christmas/sparks.png";
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
  [FxType.MiniExplosion]: {
    url: miniExplosion,
    frameWidth: 13,
    frameCount: 4,
    frameDuration: 70,
    looping: false,
    originX: 6,
    originY: 6,
  },
  [FxType.Dust]: {
    url: dust,
    frameWidth: 9,
    frameCount: 3,
    frameDuration: 100,
    looping: false,
    originX: 4,
    originY: 5,
  },
  [FxType.UnitExplosion]: {
    url: unitExplosion,
    frameWidth: 19,
    frameCount: 4,
    frameDuration: 70,
    looping: false,
    originX: 9,
    originY: 9,
  },
  [FxType.BuildingExplosion]: {
    url: buildingExplosion,
    frameWidth: 17,
    frameCount: 10,
    frameDuration: 70,
    looping: false,
    originX: 8,
    originY: 8,
  },
  [FxType.SinkingShip]: {
    url: sinkingShip,
    frameWidth: 16,
    frameCount: 14,
    frameDuration: 90,
    looping: false,
    originX: 7,
    originY: 7,
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
  [FxType.Conquest]: {
    url: conquestSword,
    frameWidth: 21,
    frameCount: 10,
    frameDuration: 90,
    looping: false,
    originX: 10,
    originY: 16,
  },
  [FxType.Santa]: {
    url: santa,
    frameWidth: 34,
    frameCount: 8,
    frameDuration: 90,
    looping: true,
    originX: 16,
    originY: 15,
  },
  [FxType.Snowman]: {
    url: snowman,
    frameWidth: 16,
    frameCount: 19,
    frameDuration: 200,
    looping: false,
    originX: 8,
    originY: 12,
  },
  [FxType.HappyElf]: {
    url: happyElf,
    frameWidth: 7,
    frameCount: 5,
    frameDuration: 90,
    looping: true,
    originX: 3,
    originY: 7,
  },
  [FxType.SadElf]: {
    url: sadElf,
    frameWidth: 14,
    frameCount: 10,
    frameDuration: 90,
    looping: true,
    originX: 6,
    originY: 10,
  },
  [FxType.Sparks]: {
    url: sparks,
    frameWidth: 13,
    frameCount: 13,
    frameDuration: 60,
    looping: false,
    originX: 6,
    originY: 6,
  },
};

export class AnimatedSpriteLoader {
  private animatedSpriteImageMap: Map<FxType, HTMLCanvasElement> = new Map();
  // Do not color the same sprite twice
  private coloredAnimatedSpriteCache: Map<string, HTMLCanvasElement> =
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
          canvas.getContext("2d")!.drawImage(img, 0, 0);

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
    const territoryColor = owner.territoryColor();
    const borderColor = owner.borderColor();
    const spawnHighlightColor = theme.spawnHighlightColor();
    const key = `${fxType}-${owner.id()}`;
    let coloredCanvas: HTMLCanvasElement;
    if (this.coloredAnimatedSpriteCache.has(key)) {
      coloredCanvas = this.coloredAnimatedSpriteCache.get(key)!;
    } else {
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
