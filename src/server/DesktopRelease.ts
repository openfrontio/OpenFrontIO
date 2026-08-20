import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { logger } from "./Logger";

const log = logger.child({ comp: "desktop-release" });

// Bump ONLY when a client genuinely cannot run on an older desktop shell.
// A shell below this refuses to stage the update and tells the player to take
// a Steam update, so a careless bump strands every installed client.
const MIN_SHELL_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Mirror of the desktop shell's safeOverlayPath / safeManifestTarget.
//
// SOURCE OF TRUTH: openfront-desktop's src/main/update/descriptor.ts. The two
// repositories cannot import from each other, so this is duplicated on purpose
// -- the same arrangement as multiplayerAllowed in src/client/DesktopShell.ts.
// If the shell's rules change, change these to match.
//
// This exists because the shell's parseDescriptor THROWS on the first value it
// refuses and aborts the parse of the entire descriptor. That is not a degraded
// asset; it is every Steam client landing in `failed` on every launch. A
// prefix-only check here would be weaker than the rule it is meant to
// anticipate: parseDescriptor also rejects "%", "?", "#", backslashes, NUL,
// UNC paths, drive letters and traversal segments, and it validates the assets
// map's KEYS as well as its urls. Catching all of that at build time is the
// entire point of asserting here at all.
const ALLOWED_ROOTS = ["assets/", "_assets/"];

// Same mirror-of-the-shell rationale as ALLOWED_ROOTS above: parseDescriptor
// in openfront-desktop's src/main/update/descriptor.ts requires `sha256` to be
// 64 lowercase hex characters and `bytes` a non-negative integer, and throws
// on the first entry that isn't -- aborting the parse of the WHOLE descriptor.
// asset-hashes.json is generated, not hand-written, but a bug in
// scripts/buildAssetHashes.ts (or a corrupted build artifact) would otherwise
// pass straight through this file and only surface once every Steam client
// fails to update.
const SHA256 = /^[0-9a-f]{64}$/;

function shellWouldRefuse(value: string): boolean {
  if (typeof value !== "string" || value === "") return true;
  // NUL, written as an escape rather than a raw byte: 171 real flag
  // filenames contain a literal SPACE, which the shell accepts, and an
  // embedded NUL renders as one in most editors. A raw NUL here would also
  // make git treat this file as binary.
  if (value.includes("\u0000")) return true;
  if (value.includes("%")) return true;
  if (value.includes("\\")) return true;
  if (value.includes("?") || value.includes("#")) return true;
  if (value.startsWith("//")) return true;
  if (/^[a-zA-Z]:/.test(value)) return true;

  const rel = value.startsWith("/") ? value.slice(1) : value;
  if (rel === "") return true;
  if (rel.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    return true;
  }
  return !ALLOWED_ROOTS.some((root) => rel.startsWith(root));
}

// asset-manifest.json holds percent-ENCODED hrefs where asset-hashes.json holds
// literal paths -- 171 flag filenames in the current build contain a space,
// carried here as %20. The shell decodes before applying its rules, so this
// must too, or every one of those would look like a violation.
function shellWouldRefuseManifestValue(value: string): boolean {
  if (typeof value !== "string" || value === "") return true;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return true;
  }
  return shellWouldRefuse(decoded);
}

export interface ReleaseAsset {
  url: string;
  sha256: string;
  bytes: number;
}

export interface ReleaseDescriptor {
  schemaVersion: 1;
  clientVersion: string;
  coreVersion: string;
  minShellVersion: string;
  cdnBase: string;
  template: { html: string; sha256: string };
  /**
   * The download set, keyed by emitted path
   * ("_assets/atlases/emoji-atlas.eb6eeb4f.png").
   */
  assets: Record<string, ReleaseAsset>;
  /**
   * static/asset-manifest.json verbatim: the SEMANTIC mapping
   * ("atlases/emoji-atlas.png" -> "/_assets/atlases/emoji-atlas.eb6eeb4f.png")
   * the client resolves asset names through at runtime.
   *
   * A separate field from `assets` because the two key-spaces are different and
   * overlap in only a handful of entries -- the Vite `assets/**` outputs, where
   * the semantic name happens to equal the emitted path. Deriving one from the
   * other yields a manifest whose `_assets/**` lookups all miss, and a client
   * that boots but cannot start a game.
   */
  assetManifest: Record<string, string>;
}

export interface VersionPointer {
  clientVersion: string;
  coreVersion: string;
}

interface BuildOpts {
  clientVersion: string;
  cdnBase: string;
}

let cached: Promise<ReleaseDescriptor> | null = null;

export function clearDesktopReleaseCache(): void {
  cached = null;
}

export async function buildDescriptor(
  staticDir: string,
  opts: BuildOpts,
): Promise<ReleaseDescriptor> {
  const [html, hashesRaw, coreRaw, manifestRaw] = await Promise.all([
    fs.readFile(path.join(staticDir, "index.html"), "utf-8"),
    fs.readFile(path.join(staticDir, "asset-hashes.json"), "utf-8"),
    fs.readFile(path.join(staticDir, "core-version.txt"), "utf-8"),
    fs.readFile(path.join(staticDir, "asset-manifest.json"), "utf-8"),
  ]);

  const hashes = JSON.parse(hashesRaw) as Record<
    string,
    { sha256: string; bytes: number }
  >;
  if (Object.keys(hashes).length === 0) {
    throw new Error(
      "asset-hashes.json is empty — did scripts/buildAssetHashes.ts run after the Vite build?",
    );
  }

  const assets: Record<string, ReleaseAsset> = {};
  for (const [rel, h] of Object.entries(hashes)) {
    const url = `/${rel}`;
    // Fail the BUILD rather than every client. Both the KEY and the URL are
    // checked, because parseDescriptor validates both.
    if (shellWouldRefuse(rel) || shellWouldRefuse(url)) {
      throw new Error(
        `asset-hashes.json contains "${rel}", which the desktop shell's ` +
          `safeOverlayPath refuses — it must be under assets/ or _assets/ and ` +
          `free of "%", "?", "#", backslashes, NUL and traversal segments. ` +
          `The shell rejects the WHOLE descriptor on it, so every Steam client ` +
          `would fail to update. Fix hashDirectory in ` +
          `scripts/buildAssetHashes.ts.`,
      );
    }
    // Check the entry is an object before reading its fields. JSON null is
    // typeof "object", so `h.sha256` on one throws a bare TypeError naming
    // nothing -- losing the key and the reason, which is the whole point of
    // failing here rather than in every client.
    // Check the entry is an object before reading its fields. JSON null is
    // typeof "object", so `h.sha256` on one throws a bare TypeError naming
    // nothing -- losing the key and the reason, which is the whole point of
    // failing here rather than in every client.
    if (typeof h !== "object" || h === null || Array.isArray(h)) {
      throw new Error(
        `asset-hashes.json["${rel}"] is not an object. Expected ` +
          `{ sha256, bytes } from scripts/buildAssetHashes.ts.`,
      );
    }
    // sha256/bytes are taken from a generated file and used as-is elsewhere,
    // so a malformed entry here would otherwise reach parseDescriptor
    // untouched -- same build-time-vs-runtime tradeoff as the path check
    // above.
    if (typeof h.sha256 !== "string" || !SHA256.test(h.sha256)) {
      throw new Error(
        `asset-hashes.json["${rel}"].sha256 is not 64 lowercase hex ` +
          `characters, which the desktop shell's parseDescriptor requires. ` +
          `The shell rejects the WHOLE descriptor on it, so every Steam ` +
          `client would fail to update.`,
      );
    }
    if (
      typeof h.bytes !== "number" ||
      !Number.isInteger(h.bytes) ||
      h.bytes < 0
    ) {
      throw new Error(
        `asset-hashes.json["${rel}"].bytes is not a non-negative integer, ` +
          `which the desktop shell's parseDescriptor requires. The shell ` +
          `rejects the WHOLE descriptor on it, so every Steam client would ` +
          `fail to update.`,
      );
    }
    assets[rel] = { url, sha256: h.sha256, bytes: h.bytes };
  }

  const assetManifest = JSON.parse(manifestRaw) as Record<string, string>;
  if (Object.keys(assetManifest).length === 0) {
    throw new Error(
      "asset-manifest.json is empty — the desktop client resolves every asset name through it",
    );
  }
  for (const [name, target] of Object.entries(assetManifest)) {
    // Values only. The keys are semantic names the client looks up by, never
    // paths, and the shell does not constrain them beyond being strings.
    if (shellWouldRefuseManifestValue(target)) {
      throw new Error(
        `asset-manifest.json maps "${name}" to "${target}", which the desktop ` +
          `shell's safeManifestTarget refuses once decoded. The shell rejects ` +
          `the WHOLE descriptor on it, so every Steam client would fail to ` +
          `update.`,
      );
    }
  }

  if (opts.cdnBase === "") {
    log.warn(
      "CDN_BASE is unset — desktop release assets will be served from the app's own origin instead of a CDN",
    );
  }

  return {
    schemaVersion: 1,
    clientVersion: opts.clientVersion,
    coreVersion: coreRaw.trim(),
    minShellVersion: MIN_SHELL_VERSION,
    cdnBase: opts.cdnBase,
    template: {
      html,
      sha256: createHash("sha256").update(html).digest("hex"),
    },
    assets,
    assetManifest,
  };
}

export function getDescriptor(
  staticDir: string,
  opts: BuildOpts,
): Promise<ReleaseDescriptor> {
  if (cached === null) {
    cached = buildDescriptor(staticDir, opts).catch((err: unknown) => {
      // Do not cache a failure: a transient read error would otherwise poison
      // the endpoint for the life of the process.
      cached = null;
      throw err;
    });
  }
  return cached;
}
