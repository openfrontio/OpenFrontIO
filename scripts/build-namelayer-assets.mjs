import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "..");
const fontsDir = path.join(root, "resources", "fonts");
const imagesDir = path.join(root, "resources", "images");

const fontPng = "namelayer_overpass.png";
const fontXml = "namelayer_overpass.xml";
const fontFace = "namelayer_overpass";
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

const canvasApi = await loadCanvasApi();

await buildMsdfFont();
await buildIconAtlas();
await buildEmojiAtlas();

async function loadCanvasApi() {
  try {
    const api = await import("canvas");
    const fontPath = fontSourceCandidates
      .map((fileName) => path.join(fontsDir, fileName))
      .find((candidate) => fs.existsSync(candidate));
    try {
      if (!fontPath) {
        throw new Error(
          `No Overpass font source found. Tried: ${fontSourceCandidates.join(
            ", ",
          )}`,
        );
      }
      api.registerFont(fontPath, {
        family: "OverpassNameLayer",
      });
    } catch (error) {
      console.warn(
        "Could not register Overpass; using canvas fallback font",
        error,
      );
    }
    return api;
  } catch (error) {
    console.warn(
      "canvas native bindings are unavailable; writing deterministic fallback NameLayer assets",
      error,
    );
    return null;
  }
}

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
  if (!canvasApi) {
    writeFallbackAtlas("namelayer-icons", iconSources);
    return;
  }

  const { createCanvas, loadImage } = canvasApi;
  const cell = 256;
  const cols = 4;
  const rows = Math.ceil(iconSources.length / cols);
  const canvas = createCanvas(cols * cell, rows * cell);
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
      const img = await loadIconImage(path.join(imagesDir, source), loadImage);
      ctx.drawImage(img, x, y, cell, cell);
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

  fs.writeFileSync(
    path.join(imagesDir, "namelayer-icons.png"),
    canvas.toBuffer("image/png"),
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

async function loadIconImage(sourcePath, loadImage) {
  if (path.extname(sourcePath).toLowerCase() !== ".svg") {
    return loadImage(sourcePath);
  }

  let svg = fs.readFileSync(sourcePath, "utf8");
  if (!/<svg[^>]*\swidth=/i.test(svg) || !/<svg[^>]*\sheight=/i.test(svg)) {
    const [, , , width, height] =
      svg.match(
        /viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i,
      ) ?? [];
    svg = svg.replace(
      /<svg\b/i,
      `<svg width="${width ?? 64}" height="${height ?? 64}"`,
    );
  }

  return loadImage(
    `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
  );
}

async function buildEmojiAtlas() {
  if (!canvasApi) {
    const emojis = readEmojiTable();
    writeFallbackAtlas("namelayer-emojis", emojis);
    return;
  }

  const { createCanvas } = canvasApi;
  const emojis = readEmojiTable();
  const cell = 128;
  const cols = 8;
  const rows = Math.max(1, Math.ceil(emojis.length / cols));
  const canvas = createCanvas(cols * cell, rows * cell);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font =
    '96px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  const frames = {};

  emojis.forEach((emoji, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = col * cell;
    const y = row * cell;
    ctx.fillText(emoji, x + cell / 2, y + cell / 2);
    frames[emoji] = {
      frame: { x, y, w: cell, h: cell },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cell, h: cell },
      sourceSize: { w: cell, h: cell },
    };
  });

  fs.writeFileSync(
    path.join(imagesDir, "namelayer-emojis.png"),
    canvas.toBuffer("image/png"),
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

function writeFallbackAtlas(name, keys) {
  const transparentPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lD6N7wAAAABJRU5ErkJggg==",
    "base64",
  );
  const frames = {};

  for (const key of keys) {
    frames[key] = {
      frame: { x: 0, y: 0, w: 1, h: 1 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 1, h: 1 },
      sourceSize: { w: 1, h: 1 },
    };
  }

  fs.writeFileSync(path.join(imagesDir, `${name}.png`), transparentPng);
  fs.writeFileSync(
    path.join(imagesDir, `${name}.json`),
    `${JSON.stringify(
      {
        frames,
        meta: {
          app: "scripts/build-namelayer-assets.mjs",
          image: `${name}.png`,
          format: "RGBA8888",
          size: { w: 1, h: 1 },
          scale: "1",
        },
      },
      null,
      2,
    )}\n`,
  );
}
