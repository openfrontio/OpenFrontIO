/**
 * Multi-format export for `<replay-viewer>`:
 * - `png`: current canvas frame screenshot
 * - `webm`: video timelapse captured from the replay canvas
 * - `gif`: animated GIF89a territory expansion timelapse
 * - `json`: portable replay archive (StoredReplay + metadata)
 * - `csv`: tick-by-tick player telemetry & stats table
 */

import { FALLOUT_BIT, OWNER_MASK } from "../render/gl/utils/TileCodec";
import type { PlayerStatic } from "../render/types";
import { playerTypeFromEnum } from "../view/EntityState";
import { gunzipInBrowser, gzipInBrowser } from "./BrowserGzip";
import { ReplayReader } from "./codec/decode/ReplayReader";
import {
  REPLAY_VERSION,
  type GzipFn,
  type InflateFn,
  type ReplayBase,
  type ReplayData,
} from "./codec/ReplayTypes";
import { TICKS_PER_SECOND } from "./ReplayPlayback";
import { fromStored, toStored, type StoredReplay } from "./ReplayStore";
import { ReplayTerrain } from "./ReplayTerrain";

export const EXPORT_FORMATS = [
  "mp4",
  "webm",
  "gif",
  "png",
  "json",
  "csv",
] as const;
export type ReplayExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportedReplayArchive {
  format: "openfront-replay";
  version: number;
  gameID: string;
  exportedAt: string;
  totalFrames: number;
  base: ReplayBase;
  players: PlayerStatic[];
  unitTypes: string[];
  events: StoredReplay["append"]["events"];
  packedEventsBase64: string;
  chunks: { frameCount: number; compressedBase64: string }[];
}

/** Clean filename for a given game ID and export format. */
export function exportFilename(
  gameID: string,
  format: ReplayExportFormat,
  tick = 0,
  extensionOverride?: string,
): string {
  const safeId = gameID.replace(/[^a-zA-Z0-9_-]/g, "") || "replay";
  switch (format) {
    case "png":
      return `openfront-${safeId}-t${Math.max(0, Math.floor(tick))}.png`;
    case "mp4":
      return `openfront-${safeId}-full.${extensionOverride ?? "mp4"}`;
    case "webm":
      return `openfront-${safeId}-timelapse.${extensionOverride ?? "webm"}`;
    case "gif":
      return `openfront-${safeId}-timelapse.gif`;
    case "json":
      return `openfront-${safeId}-replay.json`;
    case "csv":
      return `openfront-${safeId}-stats.csv`;
  }
}

/** Triggers a browser file download for a Blob. */
export function downloadBlob(
  blob: Blob,
  filename: string,
  doc: Document = document,
): void {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Pick evenly spaced frame indices in `[0, totalFrames - 1]`, always including start and end. */
export function sampleFrameIndices(
  totalFrames: number,
  maxSamples: number,
): number[] {
  const total = Math.max(0, Math.floor(totalFrames));
  const limit = Math.max(1, Math.floor(maxSamples));
  if (total === 0) return [];
  if (total <= limit) {
    return Array.from({ length: total }, (_, i) => i);
  }
  if (limit === 1) return [total - 1];
  const indices: number[] = [];
  for (let i = 0; i < limit; i++) {
    const idx = Math.round((i * (total - 1)) / (limit - 1));
    if (indices.length === 0 || indices[indices.length - 1] !== idx) {
      indices.push(idx);
    }
  }
  return indices;
}

// ---- 1. PNG Screenshot ----

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("invalid data URL");
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mimeMatch = /^data:([^;,]+)/.exec(header);
  const mime = mimeMatch?.[1] ?? "image/png";
  const bytes = base64ToBytes(body);
  return new Blob([bytes as BlobPart], { type: mime });
}

export async function exportScreenshotPng(
  canvas: HTMLCanvasElement,
  drawFrame?: () => void,
): Promise<Blob> {
  drawFrame?.();
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/png");
    });
    if (blob !== null) return blob;
  }
  if (typeof canvas.toDataURL === "function") {
    const url = canvas.toDataURL("image/png");
    if (url.startsWith("data:")) return dataUrlToBlob(url);
  }
  throw new Error("canvas screenshot capture is unavailable");
}

// ---- 2. Video Export (Full Match & Timelapse) ----

export interface VideoExportOptions {
  canvas: HTMLCanvasElement;
  totalFrames: number;
  seekAndDraw: (frame: number) => Promise<void>;
  /** When null or undefined, records all frames from 0 to totalFrames - 1. */
  maxFrames?: number | null;
  fps?: number;
  frameDelayMs?: number;
  preferredFormat?: "mp4" | "webm";
  signal?: AbortSignal;
}

export interface VideoExportResult {
  blob: Blob;
  ext: "mp4" | "webm";
}

export function pickVideoMimeType(preferred: "mp4" | "webm" = "mp4"): {
  mimeType: string;
  ext: "mp4" | "webm";
} {
  if (typeof MediaRecorder === "undefined") {
    return { mimeType: "video/webm", ext: "webm" };
  }
  const mp4Candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1",
    "video/mp4;codecs=h264",
    "video/mp4",
  ];
  const webmCandidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  if (preferred === "mp4") {
    for (const mime of mp4Candidates) {
      if (
        typeof MediaRecorder.isTypeSupported === "function" &&
        MediaRecorder.isTypeSupported(mime)
      ) {
        return { mimeType: mime, ext: "mp4" };
      }
    }
  }

  for (const mime of webmCandidates) {
    if (
      typeof MediaRecorder.isTypeSupported !== "function" ||
      MediaRecorder.isTypeSupported(mime)
    ) {
      return { mimeType: mime, ext: "webm" };
    }
  }

  for (const mime of mp4Candidates) {
    if (
      typeof MediaRecorder.isTypeSupported === "function" &&
      MediaRecorder.isTypeSupported(mime)
    ) {
      return { mimeType: mime, ext: "mp4" };
    }
  }

  return { mimeType: "video/webm", ext: "webm" };
}

export async function exportVideo(
  opts: VideoExportOptions,
): Promise<VideoExportResult> {
  const {
    canvas,
    totalFrames,
    seekAndDraw,
    maxFrames = null,
    fps = 30,
    frameDelayMs,
    preferredFormat = "mp4",
    signal,
  } = opts;
  const captureCanvas = canvas as HTMLCanvasElement & {
    captureStream?: (frameRate?: number) => MediaStream;
  };
  if (
    typeof MediaRecorder === "undefined" ||
    typeof captureCanvas.captureStream !== "function"
  ) {
    throw new Error("video recording is not supported in this browser");
  }

  const frames =
    maxFrames === null || maxFrames >= totalFrames
      ? Array.from({ length: totalFrames }, (_, i) => i)
      : sampleFrameIndices(totalFrames, maxFrames);
  if (frames.length === 0) {
    throw new Error("no frames to export");
  }

  const { mimeType, ext } = pickVideoMimeType(preferredFormat);
  // Use captureStream(0) so the canvas stream only captures frames on demand
  // via track.requestFrame(), avoiding dropped or duplicate frames.
  let stream = captureCanvas.captureStream(0);
  let track = stream.getVideoTracks?.()[0] as
    | (MediaStreamTrack & { requestFrame?: () => void })
    | undefined;
  if (!track || typeof track.requestFrame !== "function") {
    for (const t of stream.getTracks?.() ?? []) t.stop?.();
    stream = captureCanvas.captureStream(fps);
    track = stream.getVideoTracks?.()[0];
  }

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];

  recorder.addEventListener("dataavailable", (e: BlobEvent) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  });

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener("stop", () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
    });
    recorder.addEventListener("error", () => {
      reject(new Error("video recording failed"));
    });
  });

  const targetIntervalMs = frameDelayMs ?? Math.max(1, Math.round(1000 / fps));
  recorder.start();
  try {
    let nextFrameTime = performance.now();
    for (const f of frames) {
      if (signal?.aborted) break;
      await seekAndDraw(f);
      if (signal?.aborted) break;
      track?.requestFrame?.();
      nextFrameTime += targetIntervalMs;
      const delay = nextFrameTime - performance.now();
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      } else {
        nextFrameTime = performance.now();
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    for (const t of stream.getTracks?.() ?? []) {
      t.stop?.();
    }
  }

  const blob = await stopped;
  return { blob, ext };
}

export async function exportTimelapseWebm(
  opts: VideoExportOptions,
): Promise<Blob> {
  const res = await exportVideo({
    ...opts,
    maxFrames: opts.maxFrames ?? 120,
    fps: opts.fps ?? 30,
    preferredFormat: "webm",
  });
  return res.blob;
}

// ---- 3. Animated GIF89a Timelapse ----

function parseHexRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 6) {
    const n = Number.parseInt(clean, 16);
    if (!Number.isNaN(n)) {
      return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    }
  } else if (clean.length === 3) {
    const r = Number.parseInt(clean[0] + clean[0], 16);
    const g = Number.parseInt(clean[1] + clean[1], 16);
    const b = Number.parseInt(clean[2] + clean[2], 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r, g, b];
    }
  }
  return null;
}

function fallbackColorForSmallId(smallID: number): [number, number, number] {
  // Golden-angle hue distribution in RGB.
  const hue = ((smallID * 137.508) % 360) / 60;
  const c = 180;
  const x = Math.round(c * (1 - Math.abs((hue % 2) - 1)));
  const base = 55;
  const seg = Math.floor(hue);
  switch (seg) {
    case 0:
      return [base + c, base + x, base];
    case 1:
      return [base + x, base + c, base];
    case 2:
      return [base, base + c, base + x];
    case 3:
      return [base, base + x, base + c];
    case 4:
      return [base + x, base, base + c];
    default:
      return [base + c, base, base + x];
  }
}

/** LZW minimum code size 8 (256-entry global color table) GIF89a encoder. */
export function encodeGif89a(
  frames: readonly Uint8Array[],
  width: number,
  height: number,
  palette: Uint8Array,
  delayCs = 8,
): Uint8Array {
  if (width <= 0 || height <= 0) {
    throw new RangeError(`invalid GIF dimensions ${width}x${height}`);
  }
  if (palette.length !== 256 * 3) {
    throw new RangeError("GIF palette must have 256 RGB entries (768 bytes)");
  }

  const out: number[] = [];
  const pushBytes = (...vals: number[]) => {
    for (const v of vals) out.push(v & 0xff);
  };
  const pushU16LE = (v: number) => {
    out.push(v & 0xff, (v >> 8) & 0xff);
  };
  const pushAscii = (str: string) => {
    for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xff);
  };

  // Header: GIF89a
  pushAscii("GIF89a");
  // Logical Screen Descriptor (Global Color Table Flag = 1, 8-bit color, size = 7 -> 256 entries)
  pushU16LE(width);
  pushU16LE(height);
  pushBytes(0xf7, 0x00, 0x00);
  // Global Color Table (768 bytes)
  for (let i = 0; i < 768; i++) out.push(palette[i]);

  // Netscape 2.0 Application Extension for infinite looping
  pushBytes(0x21, 0xff, 0x0b);
  pushAscii("NETSCAPE2.0");
  pushBytes(0x03, 0x01, 0x00, 0x00, 0x00);

  for (const pixels of frames) {
    if (pixels.length !== width * height) {
      throw new RangeError(
        `frame has ${pixels.length} pixels, expected ${width * height}`,
      );
    }
    // Graphic Control Extension
    pushBytes(0x21, 0xf9, 0x04, 0x04);
    pushU16LE(delayCs);
    pushBytes(0x00, 0x00);

    // Image Descriptor
    pushBytes(0x2c);
    pushU16LE(0);
    pushU16LE(0);
    pushU16LE(width);
    pushU16LE(height);
    pushBytes(0x00);

    // Image Data (LZW with minCodeSize = 8)
    lzwEncodeFrame(pixels, out);
  }

  // Trailer
  pushBytes(0x3b);
  return Uint8Array.from(out);
}

function lzwEncodeFrame(pixels: Uint8Array, out: number[]): void {
  const minCodeSize = 8;
  const clearCode = 256;
  const eoiCode = 257;
  out.push(minCodeSize);

  let subBlock: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1; // 9 bits initially
  let nextCode = eoiCode + 1; // 258

  // Dictionary mapping (prefix << 8) | suffix -> code
  const dict = new Int32Array(4096 * 256).fill(-1);

  const flushSubBlock = () => {
    if (subBlock.length === 0) return;
    out.push(subBlock.length);
    for (let i = 0; i < subBlock.length; i++) out.push(subBlock[i]);
    subBlock = [];
  };

  const writeCode = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      subBlock.push(bitBuffer & 0xff);
      if (subBlock.length === 255) flushSubBlock();
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  writeCode(clearCode);
  if (pixels.length === 0) {
    writeCode(eoiCode);
  } else {
    let prefix = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
      const k = pixels[i];
      const key = (prefix << 8) | k;
      const hit = dict[key];
      if (hit !== -1) {
        prefix = hit;
      } else {
        writeCode(prefix);
        if (nextCode < 4096) {
          dict[key] = nextCode++;
          if (nextCode > 1 << codeSize && codeSize < 12) {
            codeSize++;
          }
        } else {
          writeCode(clearCode);
          dict.fill(-1);
          codeSize = minCodeSize + 1;
          nextCode = eoiCode + 1;
        }
        prefix = k;
      }
    }
    writeCode(prefix);
    writeCode(eoiCode);
  }

  if (bitCount > 0) {
    subBlock.push(bitBuffer & 0xff);
  }
  flushSubBlock();
  out.push(0x00); // Block terminator
}

export interface GifExportOptions {
  maxFrames?: number;
  maxDimension?: number;
  delayCs?: number;
  players?: readonly PlayerStatic[];
}

/**
 * Generates an animated GIF89a timelapse directly from the replay's decoded
 * frames, terrain, and player colors without disturbing the live viewer.
 */
export async function exportReplayGif(
  data: ReplayData,
  inflate: InflateFn = gunzipInBrowser,
  initialTerrain: Uint8Array,
  opts: GifExportOptions = {},
): Promise<Blob> {
  const {
    maxFrames = 60,
    maxDimension = 320,
    delayCs = 8,
    players = data.append.players,
  } = opts;

  const reader = new ReplayReader(data.base, inflate);
  reader.append(data.append);
  const total = reader.header.totalFrames;
  const indices = sampleFrameIndices(total, maxFrames);
  if (indices.length === 0) {
    throw new Error("no frames to export");
  }

  const mapW = data.base.mapWidth;
  const mapH = data.base.mapHeight;
  const scale = Math.min(1, maxDimension / Math.max(mapW, mapH));
  const outW = Math.max(1, Math.round(mapW * scale));
  const outH = Math.max(1, Math.round(mapH * scale));

  // Build 256-color palette:
  // 0: Water, 1: Unowned land, 2: Shore/Mountain, 3: Fallout, 4..255: Players
  const palette = new Uint8Array(256 * 3);
  const setEntry = (idx: number, r: number, g: number, b: number) => {
    palette[idx * 3] = r;
    palette[idx * 3 + 1] = g;
    palette[idx * 3 + 2] = b;
  };
  setEntry(0, 32, 74, 118); // Water
  setEntry(1, 212, 203, 175); // Land
  setEntry(2, 168, 159, 134); // Shore / highland
  setEntry(3, 120, 220, 60); // Fallout

  for (let idx = 4; idx < 256; idx++) {
    const [r, g, b] = fallbackColorForSmallId(idx - 3);
    setEntry(idx, r, g, b);
  }
  for (const p of players) {
    if (p.smallID <= 0) continue;
    const slot = 4 + ((p.smallID - 1) % 252);
    const rgb =
      (p.color !== undefined ? parseHexRgb(p.color) : null) ??
      fallbackColorForSmallId(p.smallID);
    setEntry(slot, rgb[0], rgb[1], rgb[2]);
  }

  // Precompute source X and Y coordinates for each output pixel.
  const srcX = new Int32Array(outW);
  const srcY = new Int32Array(outH);
  for (let x = 0; x < outW; x++) {
    srcX[x] = Math.min(mapW - 1, Math.floor((x * mapW) / outW));
  }
  for (let y = 0; y < outH; y++) {
    srcY[y] = Math.min(mapH - 1, Math.floor((y * mapH) / outH));
  }

  const terrain = new ReplayTerrain(initialTerrain);
  const gifFrames: Uint8Array[] = [];
  const IS_LAND_BIT = 1 << 7;
  const SHORE_OR_MAG = 0x7f;

  for (const frameIdx of indices) {
    await reader.load(reader.chunkOf(frameIdx));
    const f = reader.seek(frameIdx);
    terrain.apply(f);

    const pixels = new Uint8Array(outW * outH);
    const tiles = f.tileState;
    const tBytes = terrain.bytes;

    let pIdx = 0;
    for (let y = 0; y < outH; y++) {
      const rowOffset = srcY[y] * mapW;
      for (let x = 0; x < outW; x++) {
        const ref = rowOffset + srcX[x];
        const state = tiles[ref];
        const owner = state & OWNER_MASK;
        if (state & FALLOUT_BIT) {
          pixels[pIdx++] = 3;
        } else if (owner > 0) {
          pixels[pIdx++] = 4 + ((owner - 1) % 252);
        } else {
          const tb = tBytes[ref];
          if ((tb & IS_LAND_BIT) === 0) {
            pixels[pIdx++] = 0;
          } else if ((tb & SHORE_OR_MAG) > 20) {
            pixels[pIdx++] = 2;
          } else {
            pixels[pIdx++] = 1;
          }
        }
      }
    }
    gifFrames.push(pixels);
  }

  const bytes = encodeGif89a(gifFrames, outW, outH, palette, delayCs);
  return new Blob([bytes as BlobPart], { type: "image/gif" });
}

// ---- 4. Replay Archive JSON ----

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function serializeReplayArchive(
  gameID: string,
  data: ReplayData,
  gzip: GzipFn = gzipInBrowser,
): Promise<ExportedReplayArchive> {
  const stored = await toStored(data, gzip);
  const totalFrames = stored.append.chunks.reduce(
    (sum, c) => sum + c.frameCount,
    0,
  );
  return {
    format: "openfront-replay",
    version: REPLAY_VERSION,
    gameID,
    exportedAt: new Date().toISOString(),
    totalFrames,
    base: stored.base,
    players: stored.append.players,
    unitTypes: stored.append.unitTypes,
    events: stored.append.events,
    packedEventsBase64: bytesToBase64(stored.append.packedEvents),
    chunks: stored.append.chunks.map((c) => ({
      frameCount: c.frameCount,
      compressedBase64: bytesToBase64(c.compressed),
    })),
  };
}

export async function deserializeReplayArchive(
  raw: string | ExportedReplayArchive,
  gunzip: InflateFn = gunzipInBrowser,
): Promise<{ gameID: string; data: ReplayData }> {
  const parsed = (
    typeof raw === "string" ? JSON.parse(raw) : raw
  ) as ExportedReplayArchive;
  if (parsed?.format !== "openfront-replay") {
    throw new Error("invalid replay archive format");
  }
  if (parsed?.version !== REPLAY_VERSION) {
    throw new Error(
      `unsupported replay archive version: ${parsed?.version ?? "unknown"}`,
    );
  }
  const stored: StoredReplay = {
    base: parsed.base,
    append: {
      players: parsed.players,
      unitTypes: parsed.unitTypes,
      events: parsed.events,
      packedEvents: base64ToBytes(parsed.packedEventsBase64),
      chunks: parsed.chunks.map((c) => ({
        frameCount: c.frameCount,
        compressed: base64ToBytes(c.compressedBase64),
      })),
    },
  };
  return {
    gameID: parsed.gameID,
    data: await fromStored(stored, gunzip),
  };
}

export async function exportReplayJson(
  gameID: string,
  data: ReplayData,
  gzip: GzipFn = gzipInBrowser,
): Promise<Blob> {
  const archive = await serializeReplayArchive(gameID, data, gzip);
  return new Blob([JSON.stringify(archive)], {
    type: "application/json;charset=utf-8",
  });
}

// ---- 5. Match Telemetry / Stats CSV ----

function csvCell(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  if (typeof val === "string" && /^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface StatsCsvOptions {
  /** Frame step interval (defaults to TICKS_PER_SECOND = 10 frames = 1s). */
  frameStep?: number;
  players?: readonly PlayerStatic[];
}

export async function buildMatchStatsCsv(
  data: ReplayData,
  inflate: InflateFn = gunzipInBrowser,
  opts: StatsCsvOptions = {},
): Promise<string> {
  const { frameStep = TICKS_PER_SECOND, players = data.append.players } = opts;
  const step = Math.max(1, Math.floor(frameStep));

  const reader = new ReplayReader(data.base, inflate);
  reader.append(data.append);
  const total = reader.header.totalFrames;

  const playerBySmallID = new Map<number, PlayerStatic>();
  for (const p of players) {
    playerBySmallID.set(p.smallID, p);
  }

  const header = [
    "tick",
    "frame",
    "player_id",
    "small_id",
    "name",
    "type",
    "team",
    "is_alive",
    "tiles_owned",
    "troops",
    "gold",
    "gold_earned",
    "trade_gold",
    "train_gold",
    "piracy_gold",
    "betrayals",
    "units_count",
  ].join(",");

  const rows: string[] = [header];
  if (total === 0) return rows.join("\n") + "\n";

  const targetFrames: number[] = [];
  for (let f = 0; f < total; f += step) {
    targetFrames.push(f);
  }
  if (targetFrames[targetFrames.length - 1] !== total - 1) {
    targetFrames.push(total - 1);
  }

  for (const fIdx of targetFrames) {
    await reader.load(reader.chunkOf(fIdx));
    const frame = reader.seek(fIdx);

    // Count active units per owner smallID.
    const unitCounts = new Map<number, number>();
    for (const u of frame.units.values()) {
      if (u.isActive) {
        unitCounts.set(u.ownerID, (unitCounts.get(u.ownerID) ?? 0) + 1);
      }
    }

    for (const [smallID, state] of frame.players) {
      const info = playerBySmallID.get(smallID);
      const row = [
        frame.tick,
        frame.frame,
        csvCell(info?.id ?? String(smallID)),
        smallID,
        csvCell(info?.displayName ?? info?.name ?? `Player ${smallID}`),
        csvCell(
          info !== undefined ? playerTypeFromEnum(info.playerType) : "UNKNOWN",
        ),
        csvCell(info?.team ?? ""),
        state.isAlive,
        state.tilesOwned,
        Math.round(state.troops),
        Math.round(state.gold),
        Math.round(state.goldEarned),
        Math.round(state.tradeGold),
        Math.round(state.trainGold),
        Math.round(state.piracyGold),
        state.betrayals,
        unitCounts.get(smallID) ?? 0,
      ].join(",");
      rows.push(row);
    }
  }

  return rows.join("\n") + "\n";
}

export async function exportMatchStatsCsv(
  data: ReplayData,
  inflate: InflateFn = gunzipInBrowser,
  opts: StatsCsvOptions = {},
): Promise<Blob> {
  const csv = await buildMatchStatsCsv(data, inflate, opts);
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}
