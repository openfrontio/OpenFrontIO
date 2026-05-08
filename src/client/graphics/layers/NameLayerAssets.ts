import * as PIXI from "pixi.js";
import { assetUrl } from "../../../core/AssetUrls";

const nameLayerFont = assetUrl("fonts/namelayer_overpass.xml");
const fallbackFont = assetUrl("fonts/round_6x6_modified.xml");
const iconAtlas = assetUrl("images/namelayer-icons.json");
const emojiAtlas = assetUrl("images/namelayer-emojis.json");

export const NAME_LAYER_FONT_FAMILY = "namelayer_overpass";
export const NAME_LAYER_FALLBACK_FONT_FAMILY = "round_6x6_modified";

export class NameLayerAssets {
  public fontFamily: string | null = null;
  public fontReady = false;

  private readonly textures = new Map<string, PIXI.Texture>();
  private readonly pendingTextures = new Map<string, Promise<void>>();
  private readonly warnedTextureFailures = new Set<string>();
  private preloadPromise: Promise<void> | null = null;

  preload(): Promise<void> {
    this.preloadPromise ??= this.loadBaseAssets();
    return this.preloadPromise;
  }

  getTexture(src: string): PIXI.Texture | null {
    const cached = this.textures.get(src);
    if (cached) {
      return cached;
    }

    if (!this.pendingTextures.has(src)) {
      this.pendingTextures.set(
        src,
        PIXI.Assets.load(src)
          .then((texture: PIXI.Texture) => {
            this.textures.set(src, texture);
          })
          .catch((error) => {
            this.textures.delete(src);
            this.warnTextureFailure(src, error);
          })
          .finally(() => {
            this.pendingTextures.delete(src);
          }),
      );
    }

    return null;
  }

  preloadTextures(srcs: Iterable<string>): void {
    for (const src of srcs) {
      this.getTexture(src);
    }
  }

  resetWarningsForTests(): void {
    this.warnedTextureFailures.clear();
  }

  private async loadBaseAssets(): Promise<void> {
    await this.loadFont();
    await Promise.all([
      this.loadOptionalAtlas(iconAtlas, "static icon atlas"),
      this.loadOptionalAtlas(emojiAtlas, "emoji atlas"),
    ]);
  }

  private async loadFont(): Promise<void> {
    try {
      await PIXI.Assets.load(nameLayerFont);
      this.fontFamily = NAME_LAYER_FONT_FAMILY;
      this.fontReady = true;
      return;
    } catch (error) {
      console.warn(
        "NameLayer generated bitmap font unavailable; using fallback font",
        error,
      );
    }

    try {
      await PIXI.Assets.load(fallbackFont);
      this.fontFamily = NAME_LAYER_FALLBACK_FONT_FAMILY;
      this.fontReady = true;
    } catch (error) {
      this.fontFamily = null;
      this.fontReady = false;
      console.error("NameLayer failed to load bitmap font", error);
    }
  }

  private async loadOptionalAtlas(src: string, label: string): Promise<void> {
    try {
      await PIXI.Assets.load(src);
    } catch (error) {
      console.warn(`NameLayer ${label} unavailable`, error);
    }
  }

  private warnTextureFailure(src: string, error: unknown): void {
    if (this.warnedTextureFailures.has(src)) {
      return;
    }
    this.warnedTextureFailures.add(src);
    console.warn(`NameLayer texture omitted after load failure: ${src}`, error);
  }
}
