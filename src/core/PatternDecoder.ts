import { base64url } from "jose";

export class PatternDecoder {
  private bytes: Uint8Array;
  private tileWidth: number;
  private tileHeight: number;
  private scale: number;

  constructor(base64: string) {
    this.bytes = base64url.decode(base64);

    if (this.bytes.length < 3) {
      throw new Error(
        "Pattern data is too short to contain required metadata.",
      );
    }

    const version = this.bytes[0];
    if (version !== 0) {
      throw new Error(`Unrecognized pattern version ${version}.`);
    }

    const byte1 = this.bytes[1];
    const byte2 = this.bytes[2];
    this.scale = byte1 & 0x07;

    this.tileWidth = (((byte2 & 0x03) << 5) | ((byte1 >> 3) & 0x1f)) + 2;
    this.tileHeight = ((byte2 >> 2) & 0x3f) + 2;

    const expectedBits = this.tileWidth * this.tileHeight;
    const expectedBytes = (expectedBits + 7) >> 3; // Equivalent to: ceil(expectedBits / 8);
    if (this.bytes.length - 3 < expectedBytes) {
      throw new Error(
        "Pattern data is too short for the specified dimensions.",
      );
    }
  }

  getTileWidth(): number {
    return this.tileWidth;
  }

  getTileHeight(): number {
    return this.tileHeight;
  }

  getScale(): number {
    return this.scale;
  }

  isSet(x: number, y: number): boolean {
    const px = (x >> this.scale) % this.tileWidth;
    const py = (y >> this.scale) % this.tileHeight;
    const idx = py * this.tileWidth + px;
    const byteIndex = idx >> 3;
    const bitIndex = idx & 7;
    const byte = this.bytes[3 + byteIndex];
    if (byte === undefined) throw new Error("Invalid pattern");
    return (byte & (1 << bitIndex)) !== 0;
  }
}

const animationDurations: Record<string, number> = {
  rainbow: 4000,
  "bright-rainbow": 4000,
  "copper-glow": 3000,
  "silver-glow": 3000,
  "gold-glow": 3000,
  neon: 3000,
  lava: 6000,
  water: 6200,
};

export function renderPlayerFlag(flagCode: string, target: HTMLElement) {
  if (!flagCode.startsWith("ctmfg")) return;

  const keyToLayerName: Record<string, string> = {};
  const layersObj = territoryPatterns.flag.layer;
  for (const [name, obj] of Object.entries(layersObj)) {
    if (obj && typeof obj.key === "string") {
      keyToLayerName[obj.key] = name;
    }
  }

  const code = flagCode.slice("ctmfg".length);
  const layers = code.split("_").map((segment) => {
    const [layerKey, colorKey] = segment.split("-");
    return { layerKey, colorKey };
  });

  target.innerHTML = "";
  target.style.overflow = "hidden";
  target.style.position = "relative";
  target.style.aspectRatio = "3/4";

  const colorKeyToColor: Record<string, string> = {};
  const colorObj = territoryPatterns.flag.color;
  for (const [name, obj] of Object.entries(colorObj)) {
    if (obj && typeof obj.key === "string" && typeof obj.color === "string") {
      colorKeyToColor[obj.key] = obj.color;
    }
  }

  for (const { layerKey, colorKey } of layers) {
    const layerName = keyToLayerName[layerKey] || layerKey;

    const mask = `/flags/custom/${layerName}.svg`;
    if (!mask) continue;

    const layer = document.createElement("div");
    layer.style.position = "absolute";
    layer.style.top = "0";
    layer.style.left = "0";
    layer.style.width = "100%";
    layer.style.height = "100%";

    const colorValue = colorKeyToColor[colorKey] || colorKey;
    const isSpecial =
      !colorValue.startsWith("#") &&
      !/^([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(colorValue);

    if (isSpecial) {
      const duration = animationDurations[colorValue] ?? 5000;
      const now = performance.now();
      const offset = now % duration;
      if (!duration) console.warn(`No animation duration for: ${colorValue}`);
      layer.classList.add(`flag-color-${colorValue}`);
      layer.style.animationDelay = `-${offset}ms`;
    } else {
      layer.style.backgroundColor = colorValue;
    }

    layer.style.maskImage = `url(${mask})`;
    layer.style.maskRepeat = "no-repeat";
    layer.style.maskPosition = "center";
    layer.style.maskSize = "contain";

    layer.style.webkitMaskImage = `url(${mask})`;
    layer.style.webkitMaskRepeat = "no-repeat";
    layer.style.webkitMaskPosition = "center";
    layer.style.webkitMaskSize = "contain";

    target.appendChild(layer);
  }
}
