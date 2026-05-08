import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_ üÜ.[]+-=(),':!?/@#$%&\"".split(
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

await buildBitmapFont();
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

async function buildBitmapFont() {
  if (!canvasApi) {
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

  const { createCanvas } = canvasApi;
  const cell = 64;
  const cols = 16;
  const rows = Math.ceil(glyphs.length / cols);
  const canvas = createCanvas(cols * cell, rows * cell);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = '48px "OverpassNameLayer", Arial, sans-serif';

  const chars = [];
  glyphs.forEach((glyph, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = col * cell;
    const y = row * cell;
    const metrics = ctx.measureText(glyph);
    const advance = glyph === " " ? 16 : Math.max(16, Math.ceil(metrics.width));
    const drawX = x + 4;
    const drawY = y + 48;
    if (glyph !== " ") {
      ctx.fillText(glyph, drawX, drawY);
    }
    chars.push({
      id: glyph.codePointAt(0),
      x,
      y,
      width: cell,
      height: cell,
      xadvance: advance,
      xoffset: 0,
      yoffset: 0,
      label: glyph,
    });
  });

  const xml = `<?xml version="1.0"?>
<font>
  <info face="${fontFace}" size="48" bold="0" italic="0"/>
  <common lineHeight="56" base="48" scaleW="${canvas.width}" scaleH="${canvas.height}" pages="1" packed="0"/>
  <pages>
    <page id="0" file="${fontPng}"/>
  </pages>
  <chars count="${chars.length}">
${chars
  .map(
    (char) =>
      `    <char id="${char.id}" x="${char.x}" y="${char.y}" width="${char.width}" height="${char.height}" page="0" xadvance="${char.xadvance}" xoffset="${char.xoffset}" yoffset="${char.yoffset}"/>`,
  )
  .join("\n")}
  </chars>
</font>
`;

  fs.writeFileSync(path.join(fontsDir, fontPng), canvas.toBuffer("image/png"));
  fs.writeFileSync(path.join(fontsDir, fontXml), xml);
}

async function buildIconAtlas() {
  if (!canvasApi) {
    writeFallbackAtlas("namelayer-icons", iconSources);
    return;
  }

  const { createCanvas, loadImage } = canvasApi;
  const cell = 64;
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
  const cell = 64;
  const cols = 8;
  const rows = Math.max(1, Math.ceil(emojis.length / cols));
  const canvas = createCanvas(cols * cell, rows * cell);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font =
    '48px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
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
