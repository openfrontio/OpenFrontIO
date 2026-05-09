import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Canvas, FontLibrary, loadImage } from "skia-canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "..");
const fontsDir = path.join(root, "resources", "fonts");
const imagesDir = path.join(root, "resources", "images");

const fontPng = "namelayer_overpass.png";
const fontXml = "namelayer_overpass.xml";
const fontFace = "namelayer_overpass";
const emojiFontFamily = "NameLayerEmoji";
const emojiFontPath = require.resolve("twemoji-colr-font/twemoji.woff2");
const emojiFontSize = 96;
const atlasFramePaddingRatio = 1 / 16;
const colorDetectionThreshold = 12;
const fontSourceCandidates = [
  "overpass-regular.otf",
  "overpass-regular.ttf",
  "overpass.otf",
  "overpass.ttf",
  "overpass.woff",
];
const glyphs = Array.from(
  new Set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_ \u00fc\u00dc.[]+-=(),':!?/@#$%&\"".split(
      "",
    ),
  ),
);

const iconSources = [
  "AllianceIcon.svg",
  "AllianceIconFaded.svg",
  "AllianceRequestBlackIcon.svg",
  "AllianceRequestWhiteIcon.svg",
  "CrownIcon.svg",
  "DisconnectedIcon.svg",
  "EmbargoBlackIcon.svg",
  "EmbargoWhiteIcon.svg",
  "NukeIconRed.svg",
  "NukeIconWhite.svg",
  "QuestionMarkIcon.svg",
  "TargetIcon.svg",
  "TraitorIcon.svg",
];

fs.mkdirSync(fontsDir, { recursive: true });
fs.mkdirSync(imagesDir, { recursive: true });

FontLibrary.use(emojiFontFamily, [emojiFontPath]);

await buildMsdfFont();
await buildIconAtlas();
await buildEmojiAtlas();

async function buildMsdfFont() {
  const fontPath = fontSourceCandidates
    .map((fileName) => path.join(fontsDir, fileName))
    .find((candidate) => fs.existsSync(candidate));

  if (!fontPath) {
    const fallbackXml = fs
      .readFileSync(path.join(fontsDir, "round_6x6_modified.xml"), "utf8")
      .replace(/face="round_6x6_modified"/g, `face="${fontFace}"`)
      .replace(/file="round_6x6_modified\.png"/g, `file="${fontPng}"`);
    fs.writeFileSync(
      path.join(fontsDir, fontPng),
      fs.readFileSync(path.join(fontsDir, "round_6x6_modified.png")),
    );
    fs.writeFileSync(path.join(fontsDir, fontXml), fallbackXml);
    return;
  }

  const generateBMFont = require("msdf-bmfont-xml");
  const { textures, font } = await new Promise((resolve, reject) => {
    generateBMFont(
      fontPath,
      {
        filename: path.join(fontsDir, path.basename(fontPng, ".png")),
        outputType: "xml",
        charset: glyphs,
        fontSize: 64,
        textureSize: [2048, 2048],
        texturePadding: 2,
        distanceRange: 8,
        fieldType: "msdf",
        smartSize: true,
        pot: true,
        roundDecimal: 0,
      },
      (error, textures, font) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ textures, font });
      },
      {
        log: () => {},
        warn: (message) => console.warn(`NameLayer MSDF font: ${message}`),
        error: (message) => console.error(`NameLayer MSDF font: ${message}`),
      },
    );
  });

  for (const texture of textures) {
    fs.writeFileSync(`${texture.filename}.png`, texture.texture);
  }

  const xml = String(font.data).replace(
    /(<info\s+[^>]*face=")[^"]+(")/,
    `$1${fontFace}$2`,
  );
  fs.writeFileSync(path.join(fontsDir, fontXml), xml);
}

async function buildIconAtlas() {
  const cell = 256;
  const cols = 4;
  const rows = Math.ceil(iconSources.length / cols);
  const canvas = new Canvas(cols * cell, rows * cell);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const frames = {};

  for (let i = 0; i < iconSources.length; i++) {
    const source = iconSources[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cell;
    const y = row * cell;
    try {
      const img = await loadIconImage(path.join(imagesDir, source));
      drawPackedAtlasFrame(ctx, x, y, cell, (scratchCtx, scratchSize) => {
        drawContainedImage(scratchCtx, img, 0, 0, scratchSize, scratchSize);
      });
    } catch (error) {
      console.warn(
        `Could not pack ${source}; leaving empty atlas frame`,
        error,
      );
    }
    frames[source] = {
      frame: { x, y, w: cell, h: cell },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cell, h: cell },
      sourceSize: { w: cell, h: cell },
    };
  }

  validateAtlasFramesPixels(ctx, canvas.width, canvas.height, frames, {
    label: "icon",
    requireColor: false,
  });

  fs.writeFileSync(
    path.join(imagesDir, "namelayer-icons.png"),
    await canvas.toBuffer("png"),
  );
  fs.writeFileSync(
    path.join(imagesDir, "namelayer-icons.json"),
    `${JSON.stringify(
      {
        frames,
        meta: {
          app: "scripts/build-namelayer-assets.mjs",
          image: "namelayer-icons.png",
          format: "RGBA8888",
          size: { w: canvas.width, h: canvas.height },
          scale: "1",
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function loadIconImage(sourcePath) {
  if (path.extname(sourcePath).toLowerCase() !== ".svg") {
    return loadImage(sourcePath);
  }

  let svg = fs.readFileSync(sourcePath, "utf8");
  if (!/<svg[^>]*\swidth=/i.test(svg) || !/<svg[^>]*\sheight=/i.test(svg)) {
    const viewBoxMatch = svg.match(
      /viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i,
    );
    const width = viewBoxMatch?.[3] ?? 64;
    const height = viewBoxMatch?.[4] ?? 64;
    svg = svg.replace(/<svg\b/i, `<svg width="${width}" height="${height}"`);
  }

  return loadImage(Buffer.from(svg, "utf8"));
}

async function buildEmojiAtlas() {
  const emojis = readEmojiTable();
  const cell = 128;
  const cols = 8;
  const rows = Math.max(1, Math.ceil(emojis.length / cols));
  const canvas = new Canvas(cols * cell, rows * cell);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const frames = {};

  emojis.forEach((emoji, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = col * cell;
    const y = row * cell;
    drawPackedAtlasFrame(ctx, x, y, cell, (scratchCtx, scratchSize) => {
      scratchCtx.textAlign = "center";
      scratchCtx.textBaseline = "middle";
      scratchCtx.font = `${emojiFontSize}px ${emojiFontFamily}`;
      scratchCtx.fillText(emoji, scratchSize / 2, scratchSize / 2);
    });
    frames[emoji] = {
      frame: { x, y, w: cell, h: cell },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cell, h: cell },
      sourceSize: { w: cell, h: cell },
    };
  });

  validateAtlasFramesPixels(ctx, canvas.width, canvas.height, frames, {
    label: "emoji",
    requireColor: true,
  });

  fs.writeFileSync(
    path.join(imagesDir, "namelayer-emojis.png"),
    await canvas.toBuffer("png"),
  );
  fs.writeFileSync(
    path.join(imagesDir, "namelayer-emojis.json"),
    `${JSON.stringify(
      {
        frames,
        meta: {
          app: "scripts/build-namelayer-assets.mjs",
          image: "namelayer-emojis.png",
          format: "RGBA8888",
          size: { w: canvas.width, h: canvas.height },
          scale: "1",
        },
      },
      null,
      2,
    )}\n`,
  );
}

function drawPackedAtlasFrame(targetCtx, x, y, cell, drawSource) {
  const scratchSize = cell * 2;
  const scratch = new Canvas(scratchSize, scratchSize);
  const scratchCtx = scratch.getContext("2d");
  scratchCtx.clearRect(0, 0, scratchSize, scratchSize);
  drawSource(scratchCtx, scratchSize);

  const bounds = findAlphaBounds(
    scratchCtx.getImageData(0, 0, scratchSize, scratchSize).data,
    scratchSize,
    scratchSize,
  );
  if (!bounds) {
    throw new Error("NameLayer atlas frame source rendered empty");
  }

  const sourceWidth = bounds.maxX - bounds.minX + 1;
  const sourceHeight = bounds.maxY - bounds.minY + 1;
  const padding = Math.round(cell * atlasFramePaddingRatio);
  const maxSize = cell - padding * 2;
  const scale = Math.min(maxSize / sourceWidth, maxSize / sourceHeight, 1);
  const drawWidth = Math.ceil(sourceWidth * scale);
  const drawHeight = Math.ceil(sourceHeight * scale);
  const drawX = x + Math.floor((cell - drawWidth) / 2);
  const drawY = y + Math.floor((cell - drawHeight) / 2);

  targetCtx.drawImage(
    scratch,
    bounds.minX,
    bounds.minY,
    sourceWidth,
    sourceHeight,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );
}

function drawContainedImage(ctx, image, x, y, width, height) {
  const sourceWidth = image.width ?? width;
  const sourceHeight = image.height ?? height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function findAlphaBounds(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return maxX >= minX && maxY >= minY ? { minX, minY, maxX, maxY } : null;
}

function validateAtlasFramesPixels(
  ctx,
  width,
  height,
  frames,
  { label, requireColor },
) {
  const data = ctx.getImageData(0, 0, width, height).data;
  let colorfulPixels = 0;

  for (const [key, { frame }] of Object.entries(frames)) {
    let alphaPixels = 0;
    for (let y = frame.y; y < frame.y + frame.h; y++) {
      for (let x = frame.x; x < frame.x + frame.w; x++) {
        const offset = (y * width + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const a = data[offset + 3];
        if (a === 0) {
          continue;
        }
        alphaPixels++;
        if (Math.max(r, g, b) - Math.min(r, g, b) > colorDetectionThreshold) {
          colorfulPixels++;
        }
      }
    }

    if (alphaPixels === 0) {
      throw new Error(`NameLayer ${label} atlas frame is empty: ${key}`);
    }
  }

  if (requireColor && colorfulPixels === 0) {
    throw new Error(`NameLayer ${label} atlas rendered without color pixels`);
  }
}

function readEmojiTable() {
  const utilPath = path.join(root, "src", "core", "Util.ts");
  const utilSource = fs.readFileSync(utilPath, "utf8");
  const match = utilSource.match(
    /export const emojiTable = \[([\s\S]*?)\] as const;/,
  );
  if (!match?.[1]) {
    throw new Error(
      `emojiTable not found in utilSource (${utilPath}). Start of file: ${utilSource.slice(
        0,
        160,
      )}`,
    );
  }

  return Array.from(match[1].matchAll(/"([^"]+)"/g), (match) => match[1]);
}
