import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const resourcesDir = path.join(root, "resources");
const assetsDir = path.join(root, "src", "assets");
const dataDir = path.join(assetsDir, "data");
const langDir = path.join(assetsDir, "lang");

const dataFiles = ["version.txt", "countries.json", "QuickChat.json"];

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function copyDataFiles() {
  await Promise.all(
    dataFiles.map((name) =>
      copyFile(path.join(resourcesDir, name), path.join(dataDir, name)),
    ),
  );
}

async function copyLangFiles() {
  const sourceDir = path.join(resourcesDir, "lang");
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) =>
        copyFile(
          path.join(sourceDir, entry.name),
          path.join(langDir, entry.name),
        ),
      ),
  );
}

async function main() {
  await ensureDir(dataDir);
  await ensureDir(langDir);
  await copyDataFiles();
  await copyLangFiles();
  console.log("Synced resources to src/assets.");
}

main().catch((error) => {
  console.error("sync-assets failed:", error);
  process.exit(1);
});
