import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";

export interface AssetHash {
  sha256: string;
  bytes: number;
}

// A POSITIVE allowlist, not an exclusion list, and it MUST stay identical to
// ALLOWED_ROOTS in the desktop shell's src/main/update/descriptor.ts.
//
// The shell's parseDescriptor runs safeOverlayPath over every asset url and
// THROWS on the first one outside these two roots, aborting the parse of the
// whole descriptor -- so a single stray entry does not degrade one asset, it
// takes every desktop client to the `failed` state on every launch.
//
// static/ is not only hashed content. The build copies a handful of root files
// through unhashed (LICENSE, ads.txt, privacy-policy.html, robots.txt,
// terms-of-service.html, version.txt), plus index.html (an EJS template
// rendered per-request, not an immutable asset) and asset-manifest.json. An
// exclusion list has to enumerate all of those correctly forever; an allowlist
// only has to name the two roots the overlay can actually serve.
//
// Note asset-manifest.json is NOT "superseded by the descriptor": the
// descriptor carries the download SET (keyed by emitted path), while
// asset-manifest.json carries the semantic MAPPING the client resolves names
// through (semantic name -> hashed url). The descriptor carries it as its own
// top-level `assetManifest` field -- see buildDescriptor in
// src/server/DesktopRelease.ts -- rather than as a hashed asset.
const ALLOWED_ROOTS = ["assets/", "_assets/"];

function isOverlayServable(rel: string): boolean {
  return ALLOWED_ROOTS.some((root) => rel.startsWith(root));
}

async function walk(root: string, rel = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, rel), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await walk(root, childRel)));
    } else if (entry.isFile()) {
      files.push(childRel);
    }
  }
  return files;
}

export async function hashDirectory(
  dir: string,
): Promise<Record<string, AssetHash>> {
  const files = await walk(dir);
  const out: Record<string, AssetHash> = {};
  for (const rel of files.sort()) {
    if (!isOverlayServable(rel)) continue;
    const content = await fs.readFile(path.join(dir, rel));
    out[rel] = {
      sha256: createHash("sha256").update(content).digest("hex"),
      bytes: content.byteLength,
    };
  }
  return out;
}

// Sorted before hashing so the result depends on content, not on the order the
// filesystem happens to hand back directory entries. Paths are included so a
// pure rename changes the hash.
export async function hashSourceTree(dir: string): Promise<string> {
  const files = (await walk(dir)).sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    const relBytes = Buffer.from(rel, "utf8");
    const content = await fs.readFile(path.join(dir, rel));
    // Length-prefix both fields. Feeding path and content in unseparated makes
    // the encoding ambiguous: a file "a" holding "bc" hashes identically to a
    // file "ab" holding "c", so a rename that shifts bytes across the boundary
    // would leave coreVersion unchanged -- the one thing it exists to detect.
    hash.update(`${relBytes.length}:`);
    hash.update(relBytes);
    hash.update(`${content.length}:`);
    hash.update(content);
  }
  return hash.digest("hex");
}

async function main(): Promise<void> {
  const root = path.join(import.meta.dirname, "..");
  const staticDir = path.join(root, "static");

  const hashes = await hashDirectory(staticDir);
  await fs.writeFile(
    path.join(staticDir, "asset-hashes.json"),
    `${JSON.stringify(hashes, null, 2)}\n`,
  );

  const coreVersion = await hashSourceTree(path.join(root, "src", "core"));
  await fs.writeFile(
    path.join(staticDir, "core-version.txt"),
    `${coreVersion}\n`,
  );

  console.log(
    `asset-hashes.json: ${Object.keys(hashes).length} files; core ${coreVersion.slice(0, 12)}`,
  );
}

// Only run as a script, never on import (the tests import the helpers above).
if (process.argv[1] && process.argv[1].endsWith("buildAssetHashes.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
