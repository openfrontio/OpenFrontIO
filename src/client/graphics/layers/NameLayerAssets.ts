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
  private readonly atlasTextures = new Map<string, PIXI.Texture>();
  private readonly emojiTextures = new Map<string, PIXI.Texture>();
  private readonly pendingTextures = new Map<string, Promise<void>>();
  private readonly warnedTextureFailures = new Set<string>();
  private readonly warnedMissingEmojis = new Set<string>();
  private preloadPromise: Promise<void> | null = null;

  preload(): Promise<void> {
    this.preloadPromise ??= this.loadBaseAssets();
    return this.preloadPromise;
  }

  getTexture(src: string): PIXI.Texture | null {
    const atlasTexture = this.atlasTextures.get(textureKeyFromSrc(src));
    if (atlasTexture) {
      return atlasTexture;
    }

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

  getEmojiTexture(emoji: string): PIXI.Texture | null {
    const texture = this.emojiTextures.get(emoji);
    if (texture) {
      return texture;
    }
    if (!this.warnedMissingEmojis.has(emoji)) {
      this.warnedMissingEmojis.add(emoji);
      console.warn(`NameLayer emoji omitted; atlas frame missing: ${emoji}`);
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
    this.warnedMissingEmojis.clear();
  }

  private async loadBaseAssets(): Promise<void> {
    await this.loadFont();
    await Promise.all([
      this.loadOptionalAtlas(
        iconAtlas,
        "static icon atlas",
        this.atlasTextures,
      ),
      this.loadOptionalAtlas(emojiAtlas, "emoji atlas", this.emojiTextures),
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

  private async loadOptionalAtlas(
    src: string,
    label: string,
    target: Map<string, PIXI.Texture>,
  ): Promise<void> {
    try {
      const atlas = (await PIXI.Assets.load(src)) as {
        textures?: Record<string, PIXI.Texture>;
      };
      for (const [key, texture] of Object.entries(atlas.textures ?? {})) {
        target.set(key, texture);
      }
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

function textureKeyFromSrc(src: string): string {
  const clean = src.split(/[?#]/, 1)[0] ?? src;
  const slash = clean.lastIndexOf("/");
  const key = slash >= 0 ? clean.slice(slash + 1) : clean;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}
