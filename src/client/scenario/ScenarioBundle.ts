/**
 * The scenario bundle (docs/ScenarioEditor.md, "3. Snapshot"): what players
 * download to play a scenario. It holds a header, the map files and the
 * playable snapshot, plus a thumbnail.
 *
 * Before gzip, a bundle is frames, each a little-endian u32 length and that
 * many bytes: the header (JSON), then the content, which is the manifest
 * (JSON), map.bin, map4x.bin, map16x.bin, the snapshot and the thumbnail
 * (webp). The header comes first in every format, so any build can read
 * its `format`. Its `hash` is the SHA-256 of the content's frames.
 *
 * A bundle is another player's upload, so loading one caps its inflated
 * size, checks every section and verifies the hash ("Untrusted bundles").
 */

import {
  CustomGameMap,
  GameMapSize,
} from "@openfront/engine-api/game/GameTypes";
import type { MapFiles } from "@openfront/engine-api/game/MapFiles";
import { MapManifestSchema } from "@openfront/engine-api/game/MapManifest";
import { ID } from "@openfront/engine-api/Schemas";
import { z } from "zod";
import {
  gunzipInBrowser,
  gzipInBrowser,
  InflateLimitError,
} from "../replay/BrowserGzip";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import {
  isScenarioSize,
  MAX_NATIONS,
  MAX_SIDE,
  ScenarioNationSchema,
} from "./ScenarioDocument";

/** The version of the bundle layout. A change to it gets a new one. */
export const SCENARIO_BUNDLE_FORMAT = 1;

// The three map files take 21/16 bytes a tile. A snapshot's tile lists take
// a byte a tile owned in one block, two in a checkerboard of two nations,
// and four with every tile a random one of 400 nations' (measured on
// exported 1000x1000 maps). The cap allows five, plus room for the
// thumbnail: about 166 MB on the largest map, 25M tiles.
const MAX_TILES = MAX_SIDE * MAX_SIDE;
export const MAX_BUNDLE_BYTES = MAX_TILES * (21 / 16 + 5) + 8 * 1024 * 1024;

export const ScenarioBundleHeaderSchema = z.object({
  format: z.literal(SCENARIO_BUNDLE_FORMAT),
  /** Which scenario and which of its published versions this is. */
  scenario: z.object({ id: ID, version: z.int().nonnegative() }),
  /** The build that exported it (its snapshot's gitCommit). */
  engineCommit: z.string().max(64),
  /**
   * For a lobby to show before the bundle is played. The snapshot's own
   * nations are what play and what assignments are checked against.
   */
  nations: z
    .array(
      ScenarioNationSchema.pick({
        id: true,
        name: true,
        flag: true,
        playable: true,
      }),
    )
    .max(MAX_NATIONS),
  /** SHA-256 of the content, in hex. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ScenarioBundleHeader = z.infer<typeof ScenarioBundleHeaderSchema>;

export interface ScenarioBundle {
  header: ScenarioBundleHeader;
  /** A Custom map at normal size, with all three map files. */
  files: MapFiles;
  /** Uncompressed, as GameRunner.snapshot() writes it. */
  snapshot: Uint8Array;
  /** webp. */
  thumbnail: Uint8Array;
}

/**
 * Why a bundle can't be loaded: it inflates past what a client loads, is a
 * format this build doesn't read, doesn't match its hash (or the one asked
 * for), or fails a check.
 */
export type ScenarioBundleProblem =
  | "too_large"
  | "format"
  | "hash"
  | "malformed";

export class ScenarioBundleError extends Error {
  constructor(
    readonly problem: ScenarioBundleProblem,
    message: string,
  ) {
    super(message);
  }
}

const malformed = (message: string) =>
  new ScenarioBundleError("malformed", message);

/** Everything a bundle holds but what the header derives from it. */
export type ScenarioBundleContent = Omit<ScenarioBundle, "header"> & {
  header: Omit<ScenarioBundleHeader, "format" | "hash">;
};

/** The gzipped bundle. Throws if it is more than a client loads. */
export async function encodeScenarioBundle(
  bundle: ScenarioBundleContent,
): Promise<Uint8Array> {
  const { files } = bundle;
  const content = frames([
    new TextEncoder().encode(JSON.stringify(files.manifest)),
    files.mapBin!,
    files.map4xBin!,
    files.map16xBin!,
    bundle.snapshot,
    bundle.thumbnail,
  ]);
  const header: ScenarioBundleHeader = {
    format: SCENARIO_BUNDLE_FORMAT,
    ...bundle.header,
    hash: await sha256(content),
  };
  const head = frames([new TextEncoder().encode(JSON.stringify(header))]);
  const raw = new Uint8Array(head.length + content.length);
  if (raw.length > MAX_BUNDLE_BYTES) {
    throw new Error(`the bundle is ${raw.length} bytes, over what loads`);
  }
  raw.set(head);
  raw.set(content, head.length);
  return gzipInBrowser(raw);
}

/**
 * Reads a gzipped bundle. Throws a ScenarioBundleError if it inflates past
 * MAX_BUNDLE_BYTES, is not this build's format, has a section that fails its
 * check, doesn't match its hash, or isn't the `expectedHash` a listing names
 * for it. The snapshot is checked when it is restored.
 */
export async function loadScenarioBundle(
  gzipped: Uint8Array,
  expectedHash?: string,
): Promise<ScenarioBundle> {
  const raw = await gunzipInBrowser(gzipped, MAX_BUNDLE_BYTES).catch(
    (e: unknown) => {
      throw new ScenarioBundleError(
        e instanceof InflateLimitError ? "too_large" : "malformed",
        `the bundle doesn't inflate: ${String(e)}`,
      );
    },
  );
  const reader = new FrameReader(raw);
  const header = readHeader(reader.next());
  if (expectedHash !== undefined && header.hash !== expectedHash) {
    throw new ScenarioBundleError(
      "hash",
      "the bundle is not the scenario version asked for",
    );
  }
  const content = raw.subarray(reader.offset);
  if ((await sha256(content)) !== header.hash) {
    throw new ScenarioBundleError("hash", "the bundle doesn't match its hash");
  }
  const manifestBytes = reader.next();
  // Copies, so each file has its own buffer to transfer to a worker.
  const [mapBin, map4xBin, map16xBin, snapshot, thumbnail] = [0, 1, 2, 3, 4]
    .map(() => reader.next())
    .map((frame) => frame.slice());
  reader.end();

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw malformed("the bundle's manifest is not JSON");
  }
  const manifest = MapManifestSchema.safeParse(manifestJson);
  if (!manifest.success) {
    throw malformed(`the bundle's manifest: ${manifest.error.message}`);
  }
  const { map, map4x, map16x } = manifest.data;
  const { width: w, height: h } = map;
  if (!isScenarioSize(w, h)) {
    throw malformed(`a ${w}x${h} map can't be a scenario`);
  }
  const sizes: [Uint8Array, typeof map, number][] = [
    [mapBin, map, 1],
    [map4xBin, map4x, 2],
    [map16xBin, map16x, 4],
  ];
  for (const [bin, meta, scale] of sizes) {
    if (meta.width !== w / scale || meta.height !== h / scale) {
      throw malformed(`the manifest's maps don't scale from ${w}x${h}`);
    }
    if (bin.length !== meta.width * meta.height) {
      throw malformed(
        `a ${meta.width}x${meta.height} map file has ${bin.length} bytes`,
      );
    }
  }
  if (!isWebp(thumbnail)) throw malformed("the thumbnail is not webp");

  return {
    header,
    files: {
      map: CustomGameMap,
      mapSize: GameMapSize.Normal,
      manifest: manifest.data,
      mapBin,
      map4xBin,
      map16xBin,
    },
    snapshot,
    thumbnail,
  };
}

let thumbnailUrl: string | null = null;

/**
 * Makes the client's map loader answer for the Custom map from this
 * bundle, so a game on it loads as one on a stock map does.
 */
export function useScenarioMap(bundle: ScenarioBundle): void {
  if (thumbnailUrl !== null) URL.revokeObjectURL(thumbnailUrl);
  thumbnailUrl = URL.createObjectURL(
    new Blob([bundle.thumbnail as BlobPart], { type: "image/webp" }),
  );
  terrainMapFileLoader.setCustomMap(bundle.files, thumbnailUrl);
}

function readHeader(frame: Uint8Array): ScenarioBundleHeader {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(frame));
  } catch {
    throw malformed("the bundle's header is not JSON");
  }
  const format = (json as { format?: unknown } | null)?.format;
  if (format !== SCENARIO_BUNDLE_FORMAT) {
    throw new ScenarioBundleError(
      "format",
      `bundle format ${String(format)}, this build reads ${SCENARIO_BUNDLE_FORMAT}`,
    );
  }
  const header = ScenarioBundleHeaderSchema.safeParse(json);
  if (!header.success) {
    throw malformed(`the bundle's header: ${header.error.message}`);
  }
  return header.data;
}

function frames(sections: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(
    sections.reduce((n, section) => n + 4 + section.length, 0),
  );
  const view = new DataView(out.buffer);
  let at = 0;
  for (const section of sections) {
    view.setUint32(at, section.length, true);
    out.set(section, at + 4);
    at += 4 + section.length;
  }
  return out;
}

class FrameReader {
  offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  }

  next(): Uint8Array {
    if (this.offset + 4 > this.bytes.length) {
      throw malformed("the bundle is cut short");
    }
    const length = this.view.getUint32(this.offset, true);
    const start = this.offset + 4;
    if (length > this.bytes.length - start) {
      throw malformed("the bundle is cut short");
    }
    this.offset = start + length;
    return this.bytes.subarray(start, this.offset);
  }

  end(): void {
    if (this.offset !== this.bytes.length) {
      throw malformed("the bundle has bytes after its last section");
    }
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

// A RIFF file of type WEBP.
function isWebp(bytes: Uint8Array): boolean {
  const ascii = (from: number) =>
    String.fromCharCode(...bytes.subarray(from, from + 4));
  return bytes.length >= 12 && ascii(0) === "RIFF" && ascii(8) === "WEBP";
}
