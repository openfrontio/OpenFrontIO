import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildPublicAssetManifest,
  clearPublicAssetManifestCache,
  createHashedPublicAssetFiles,
} from "../../src/server/PublicAssetManifest";

describe("PublicAssetManifest", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    clearPublicAssetManifestCache();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("hashes manifest.json from its rewritten content", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "public-assets-"));
    const resourcesDir = path.join(tempDir, "resources");
    const outDir = path.join(tempDir, "static");

    await fs.mkdir(path.join(resourcesDir, "icons"), { recursive: true });
    await fs.writeFile(
      path.join(resourcesDir, "manifest.json"),
      JSON.stringify(
        {
          name: "OpenFront",
          icons: [{ src: "icons/app-icon.png" }],
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(resourcesDir, "icons", "app-icon.png"),
      "icon-v1",
      "utf8",
    );

    const firstManifest = buildPublicAssetManifest(resourcesDir);
    const firstManifestHref = firstManifest["manifest.json"];
    const firstIconHref = firstManifest["icons/app-icon.png"];

    createHashedPublicAssetFiles(resourcesDir, outDir, firstManifest);
    const firstOutput = await fs.readFile(
      path.join(outDir, firstManifestHref.slice(1)),
      "utf8",
    );

    await fs.writeFile(
      path.join(resourcesDir, "icons", "app-icon.png"),
      "icon-v2",
      "utf8",
    );
    clearPublicAssetManifestCache();

    const secondManifest = buildPublicAssetManifest(resourcesDir);
    const secondManifestHref = secondManifest["manifest.json"];
    const secondIconHref = secondManifest["icons/app-icon.png"];

    expect(firstIconHref).not.toBe(secondIconHref);
    expect(firstManifestHref).not.toBe(secondManifestHref);
    expect(firstOutput).toContain(firstIconHref);
    expect(firstOutput).not.toContain(secondIconHref);
  });
});
