import z from "zod";
import animationConfig from "../../../resources/animatedSprites/config.json";
import { Theme } from "../../core/configuration/Config";
import { PlayerView } from "../../core/game/GameView";
import { AnimatedSprite, AnimatedSpriteConfig } from "./AnimatedSprite";
import { FxType } from "./fx/Fx";
import { colorizeCanvas } from "./SpriteLoader";

const AnimatedSpriteConfigSchema = z.object({
  name: z.string(),
  frameCount: z.number(),
  frameDuration: z.number(),
  looping: z.boolean(),
  originX: z.number(),
  originY: z.number(),
});

const AnimatedSpriteConfigsSchema = z.object({
  animatedSprites: AnimatedSpriteConfigSchema.array(),
});

interface AnimatedSpriteCanvas {
  config: AnimatedSpriteConfig;
  canvas: HTMLCanvasElement;
}

export class AnimatedSpriteLoader {
  private animatedSpriteImageMap: Map<string, AnimatedSpriteCanvas> = new Map();
  // Do not color the same sprite twice
  private coloredAnimatedSpriteCache: Map<string, AnimatedSpriteCanvas> =
    new Map();

  public async loadAllAnimatedSpriteImages() {
    const result = AnimatedSpriteConfigsSchema.safeParse(animationConfig);
    if (!result.success || !result.data) {
      throw new Error(
        `Invalid animated sprite config: ${result.error.message}`,
      );
    }
    await Promise.all(
      result.data!.animatedSprites.map((config) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = "/animatedSprites/" + config.name + ".png";
        return new Promise<void>((resolve, reject) => {
          img.onload = () => {
            this.createCanvas(config, img);
            resolve();
          };
          img.onerror = (e) => {
            reject(e);
            console.error(`Could not load animated sprite: `, e);
          };
        });
      }),
    );
  }

  private createCanvas(
    config: AnimatedSpriteConfig,
    image: HTMLImageElement,
  ): void {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    this.animatedSpriteImageMap.set(config.name, { config, canvas });
  }

  private createRegularAnimatedSprite(fxType: FxType): AnimatedSprite | null {
    const sprite = this.animatedSpriteImageMap.get(fxType);
    return sprite ? new AnimatedSprite(sprite.canvas, sprite.config) : null;
  }

  private createColoredAnimatedSpriteForUnit(
    owner: PlayerView,
    fxType: FxType,
    theme: Theme,
  ): AnimatedSprite | null {
    const key = `${fxType}-${owner.id()}`;
    const sprite = this.coloredAnimatedSpriteCache.get(key);
    if (sprite !== undefined) {
      // Use cached sprite if it was already created
      return new AnimatedSprite(sprite.canvas, sprite.config);
    } else {
      // Create one and cache it otherwise
      const animatedSprite = this.animatedSpriteImageMap.get(fxType);
      if (!animatedSprite) return null;
      const coloredSprite = this.createColoredAnimatedSpriteCanvas(
        animatedSprite,
        owner,
        theme,
      );
      this.coloredAnimatedSpriteCache.set(key, coloredSprite);
      return new AnimatedSprite(coloredSprite.canvas, coloredSprite.config);
    }
  }

  private createColoredAnimatedSpriteCanvas(
    sprite: AnimatedSpriteCanvas,
    owner: PlayerView,
    theme: Theme,
  ): AnimatedSpriteCanvas {
    const territoryColor = owner.territoryColor();
    const borderColor = owner.borderColor();
    const spawnHighlightColor = theme.spawnHighlightColor();
    const canvas = colorizeCanvas(
      sprite.canvas,
      territoryColor,
      borderColor,
      spawnHighlightColor,
    );
    return { canvas, config: sprite.config };
  }

  public createAnimatedSprite(
    fxType: FxType,
    owner?: PlayerView,
    theme?: Theme,
  ): AnimatedSprite | null {
    if (owner && theme) {
      return this.createColoredAnimatedSpriteForUnit(owner, fxType, theme);
    }
    return this.createRegularAnimatedSprite(fxType);
  }
}
