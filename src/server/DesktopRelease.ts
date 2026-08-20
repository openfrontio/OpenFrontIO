import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";

// Bump ONLY when a client genuinely cannot run on an older desktop shell.
// A shell below this refuses to stage the update and tells the player to take
// a Steam update, so a careless bump strands every installed client.
const MIN_SHELL_VERSION = "0.1.0";

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
  assets: Record<string, ReleaseAsset>;
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
  const [html, hashesRaw, coreRaw] = await Promise.all([
    fs.readFile(path.join(staticDir, "index.html"), "utf-8"),
    fs.readFile(path.join(staticDir, "asset-hashes.json"), "utf-8"),
    fs.readFile(path.join(staticDir, "core-version.txt"), "utf-8"),
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
    assets[rel] = { url: `/${rel}`, sha256: h.sha256, bytes: h.bytes };
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
