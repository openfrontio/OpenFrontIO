// Builds @openfront/cosmetic-preview: the store's cosmetic preview as a package
// other OpenFront apps install (openfrontio/opendash#74).
//
//   npm run build:cosmetic-preview
//
// Output: dist/openfront-cosmetic-preview-<version>.tgz, installable with
// `npm install <path-to-tgz>`. The version carries the commit it was built
// from, so a host always knows which game rendering it is showing.

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { build } from "vite";
import { PREVIEW_ASSET_PATHS } from "../src/client/cosmetic-preview/assets";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "cosmetic-preview");
const PACKAGE_NAME = "@openfront/cosmetic-preview";
const BASE_VERSION = "0.1.0";

/** Run Git in the repository root and return its trimmed standard output. */
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/**
 * Verify that bundled asset literals are listed and every listed file exists.
 * Map paths are assembled at runtime and covered by the asset resolution tests.
 * @throws If a referenced asset is unlisted or a listed source file is missing.
 */
function checkAssetList(): void {
  const shipped = new Set<string>(PREVIEW_ASSET_PATHS);
  const referenced = new Set<string>();
  for (const file of fs.readdirSync(outDir)) {
    if (!file.endsWith(".js")) continue;
    const js = fs.readFileSync(path.join(outDir, file), "utf8");
    for (const [, asset] of js.matchAll(
      /["'`]((?:atlases|fonts|images|sounds|flags|maps)\/[^"'`$]+)["'`]/g,
    )) {
      referenced.add(asset);
    }
  }
  const missing = [...referenced].filter((asset) => !shipped.has(asset));
  if (missing.length > 0) {
    throw new Error(
      `The bundle requests assets PREVIEW_ASSET_PATHS does not ship: ${missing.join(", ")}`,
    );
  }
  for (const asset of PREVIEW_ASSET_PATHS) {
    if (!fs.existsSync(path.join(root, "resources", asset))) {
      throw new Error(`PREVIEW_ASSET_PATHS lists a missing file: ${asset}`);
    }
  }
}

/** Copy the listed resources into the package's assets directory. */
function copyAssets(): void {
  for (const asset of PREVIEW_ASSET_PATHS) {
    const target = path.join(outDir, "assets", asset);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, "resources", asset), target);
  }
}

/**
 * Write index.d.ts from the import-free public types and runtime declarations.
 */
function writeTypes(): void {
  const api = fs.readFileSync(
    path.join(root, "src", "client", "cosmetic-preview", "api.ts"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outDir, "index.d.ts"),
    `${api}
/** Configure where assets/ is served, then load the renderer. Call once. */
export declare function loadCosmeticPreview(
  options: LoadCosmeticPreviewOptions,
): Promise<CosmeticPreviewModule>;

/** Files under assets/ the host must serve at \`\${assetBase}/\${path}\`. */
export declare const PREVIEW_ASSET_PATHS: readonly string[];
`,
  );
}

/** Write package metadata with the supplied version and commit, and copy licenses. */
function writePackageJson(version: string, commit: string): void {
  const pkg = {
    name: PACKAGE_NAME,
    version,
    description:
      "OpenFront's in-store cosmetic preview renderer, for other OpenFront apps.",
    license: "AGPL-3.0-only",
    type: "module",
    sideEffects: ["*.css"],
    exports: {
      ".": { types: "./index.d.ts", import: "./index.js" },
      "./style.css": "./style.css",
      "./assets/*": "./assets/*",
    },
    openfront: { gitCommit: commit },
  };
  fs.writeFileSync(
    path.join(outDir, "package.json"),
    `${JSON.stringify(pkg, null, 2)}\n`,
  );
  for (const license of ["LICENSE", "LICENSE-ASSETS"]) {
    fs.copyFileSync(path.join(root, license), path.join(outDir, license));
  }
}

/** Build and validate the preview library, then pack a commit-versioned tarball. */
async function main(): Promise<void> {
  const commit = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain").length > 0;
  const version = `${BASE_VERSION}-${commit.slice(0, 10)}${dirty ? ".dirty" : ""}`;

  await build({
    configFile: path.join(root, "vite.cosmetic-preview.config.ts"),
    logLevel: "warn",
  });
  checkAssetList();
  copyAssets();
  writeTypes();
  writePackageJson(version, commit);

  // Through npm's own CLI script when run as an npm script: no shell, so no
  // quoting to get wrong (Windows cannot exec "npm" without one).
  const npmCli = process.env.npm_execpath;
  const packArgs = [
    "pack",
    outDir,
    "--pack-destination",
    path.join(root, "dist"),
  ];
  const tarball = execFileSync(
    npmCli ? process.execPath : "npm",
    npmCli ? [npmCli, ...packArgs] : packArgs,
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .pop();
  console.log(`Built ${PACKAGE_NAME}@${version}: dist/${tarball}`);
  if (dirty) {
    console.warn(
      "Working tree has uncommitted changes: this build is not reproducible from a commit.",
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
