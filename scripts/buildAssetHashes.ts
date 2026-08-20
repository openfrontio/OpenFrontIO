import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";

export interface AssetHash {
  sha256: string;
  bytes: number;
}

// index.html is an EJS template rendered per-request, not an immutable asset;
// asset-manifest.json is superseded by the descriptor. Neither is fetched by
// the desktop overlay, so neither belongs in the hash map.
const EXCLUDED_ROOT_FILES = new Set(["index.html", "asset-manifest.json"]);

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
    if (EXCLUDED_ROOT_FILES.has(rel)) continue;
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
    hash.update(rel);
    hash.update(await fs.readFile(path.join(dir, rel)));
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
