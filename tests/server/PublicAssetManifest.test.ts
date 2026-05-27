import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, test } from "vitest";
import { normalizeAssetPath } from "../../src/core/AssetUrls";
import {
  buildPublicAssetManifest,
  clearPublicAssetManifestCache,
  createHashedPublicAssetFiles,
} from "../../src/server/PublicAssetManifest";

describe("PublicAssetManifest", () => {
  let tempDir: string | null = null;

  type TempResources = {
    resourcesDir: string;
    outDir: string;
  };

  async function createTempResources(): Promise<TempResources> {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "public-assets-"));
    const resourcesDir = path.join(tempDir, "resources");
    const outDir = path.join(tempDir, "static");
    await fs.mkdir(resourcesDir, { recursive: true });
    await fs.writeFile(path.join(resourcesDir, "manifest.json"), "{}\n");
    return { resourcesDir, outDir };
  }

  function getExpectedRelativeEmittedPath(
    fromAssetHref: string,
    targetAssetHref: string,
  ): string {
    const fromDir = path.posix.dirname(normalizeAssetPath(fromAssetHref));
    const targetPath = normalizeAssetPath(targetAssetHref);
    return path.posix.relative(fromDir, targetPath);
  }

  async function writeBitmapFontFixture(
    resourcesDir: string,
    xmlRelativePath: string,
    pageFilePath: string,
    pageContent: string = "png-v1",
  ): Promise<void> {
    const xmlPath = path.join(resourcesDir, xmlRelativePath);
    const pagePath = path.join(path.dirname(xmlPath), pageFilePath);
    const xmlPageFilePath = pageFilePath.split(path.sep).join(path.posix.sep);

    await fs.mkdir(path.dirname(pagePath), { recursive: true });
    await fs.writeFile(
      xmlPath,
      [
        '<?xml version="1.0"?>',
        "<font>",
        `  <pages><page id="0" file="${xmlPageFilePath}"/></pages>`,
        "</font>",
        "",
      ].join("\n"),
    );
    await fs.writeFile(pagePath, pageContent);
  }

  async function writeTextureAtlasFixture(
    resourcesDir: string,
    jsonRelativePath: string,
    imageFilePath: string,
    imageContent: string = "png-v1",
  ): Promise<void> {
    const jsonPath = path.join(resourcesDir, jsonRelativePath);
    const imagePath = path.join(path.dirname(jsonPath), imageFilePath);
    const atlasImagePath = imageFilePath.split(path.sep).join(path.posix.sep);

    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          frames: {},
          meta: {
            image: atlasImagePath,
            format: "RGBA8888",
            size: { w: 1, h: 1 },
            scale: "1",
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(imagePath, imageContent);
  }

  async function emitHashedAsset(
    outDir: string,
    assetHref: string,
  ): Promise<string> {
    return fs.readFile(
      path.join(outDir, normalizeAssetPath(assetHref)),
      "utf8",
    );
  }

  async function writeWebManifestFixture(
    resourcesDir: string,
    icons: Array<{ src?: string }>,
  ): Promise<void> {
    await fs.writeFile(
      path.join(resourcesDir, "manifest.json"),
      JSON.stringify(
        {
          name: "OpenFront",
          icons,
        },
        null,
        2,
      ),
    );
  }

  afterEach(async () => {
    clearPublicAssetManifestCache();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("hashes manifest.json from its rewritten content", async () => {
    const { resourcesDir, outDir } = await createTempResources();

    await fs.mkdir(path.join(resourcesDir, "icons"), { recursive: true });
    await writeWebManifestFixture(resourcesDir, [
      { src: "icons/app-icon.png" },
    ]);
    await fs.writeFile(
      path.join(resourcesDir, "icons", "app-icon.png"),
      "icon-v1",
      "utf8",
    );

    const firstManifest = buildPublicAssetManifest([resourcesDir]);
    const firstManifestHref = firstManifest["manifest.json"];
    const firstIconHref = firstManifest["icons/app-icon.png"];

    createHashedPublicAssetFiles([resourcesDir], outDir, firstManifest);
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

    const secondManifest = buildPublicAssetManifest([resourcesDir]);
    const secondManifestHref = secondManifest["manifest.json"];
    const secondIconHref = secondManifest["icons/app-icon.png"];

    expect(firstIconHref).not.toBe(secondIconHref);
    expect(firstManifestHref).not.toBe(secondManifestHref);
    expect(firstOutput).toContain(firstIconHref);
    expect(firstOutput).not.toContain(secondIconHref);
  });

  test("rewrites root-relative web manifest icon paths to hashed URLs", async () => {
    const { resourcesDir, outDir } = await createTempResources();

    await fs.mkdir(path.join(resourcesDir, "icons"), { recursive: true });
    await writeWebManifestFixture(resourcesDir, [
      { src: "/icons/app-icon.png" },
    ]);
    await fs.writeFile(
      path.join(resourcesDir, "icons", "app-icon.png"),
      "icon-v1",
      "utf8",
    );

    const assetManifest = buildPublicAssetManifest([resourcesDir]);
    createHashedPublicAssetFiles([resourcesDir], outDir, assetManifest);

    const emittedManifest = await emitHashedAsset(
      outDir,
      assetManifest["manifest.json"],
    );

    expect(emittedManifest).toContain(assetManifest["icons/app-icon.png"]);
    expect(emittedManifest).not.toContain('"/icons/app-icon.png"');
  });

  test("fails when web manifest references a missing local icon", async () => {
    const { resourcesDir } = await createTempResources();

    await writeWebManifestFixture(resourcesDir, [{ src: "icons/missing.png" }]);

    expect(() => buildPublicAssetManifest([resourcesDir])).toThrow(
      /manifest\.json references icons\/missing\.png/i,
    );
  });

  test("leaves external and data web manifest icon refs unchanged", async () => {
    const { resourcesDir, outDir } = await createTempResources();

    await writeWebManifestFixture(resourcesDir, [
      { src: "https://cdn.example.com/app-icon.png" },
      { src: "data:image/png;base64,AAA" },
    ]);

    const assetManifest = buildPublicAssetManifest([resourcesDir]);
    createHashedPublicAssetFiles([resourcesDir], outDir, assetManifest);

    const emittedManifest = await emitHashedAsset(
      outDir,
      assetManifest["manifest.json"],
    );

    expect(emittedManifest).toContain("https://cdn.example.com/app-icon.png");
    expect(emittedManifest).toContain("data:image/png;base64,AAA");
  });

  test("rewrites TexturePacker atlas image refs to hashed relative paths", async () => {
    const { resourcesDir, outDir } = await createTempResources();

    await writeTextureAtlasFixture(
      resourcesDir,
      path.join("images", "namelayer-icons.json"),
      "namelayer-icons.png",
    );

    const assetManifest = buildPublicAssetManifest([resourcesDir]);
    createHashedPublicAssetFiles([resourcesDir], outDir, assetManifest);

    const jsonHref = assetManifest["images/namelayer-icons.json"];
    const pngHref = assetManifest["images/namelayer-icons.png"];
    const emittedJson = await emitHashedAsset(outDir, jsonHref);
    const emittedAtlas = JSON.parse(emittedJson) as {
      meta: { image: string };
    };

    expect(emittedAtlas.meta.image).toBe(
      getExpectedRelativeEmittedPath(jsonHref, pngHref),
    );
    expect(emittedAtlas.meta.image).not.toBe("namelayer-icons.png");
  });

  test("TexturePacker atlas JSON hash changes when its image changes", async () => {
    const { resourcesDir } = await createTempResources();

    await writeTextureAtlasFixture(
      resourcesDir,
      path.join("images", "namelayer-icons.json"),
      "namelayer-icons.png",
    );

    const firstManifest = buildPublicAssetManifest([resourcesDir]);

    await fs.writeFile(
      path.join(resourcesDir, "images", "namelayer-icons.png"),
      "png-v2",
    );
    clearPublicAssetManifestCache();

    const secondManifest = buildPublicAssetManifest([resourcesDir]);

    expect(firstManifest["images/namelayer-icons.png"]).not.toBe(
      secondManifest["images/namelayer-icons.png"],
    );
    expect(firstManifest["images/namelayer-icons.json"]).not.toBe(
      secondManifest["images/namelayer-icons.json"],
    );
  });

  test("fails when TexturePacker atlas JSON references a missing image", async () => {
    const { resourcesDir } = await createTempResources();

    await fs.mkdir(path.join(resourcesDir, "images"), { recursive: true });
    await fs.writeFile(
      path.join(resourcesDir, "images", "namelayer-icons.json"),
      JSON.stringify(
        {
          frames: {},
          meta: { image: "missing.png" },
        },
        null,
        2,
      ),
    );

    expect(() => buildPublicAssetManifest([resourcesDir])).toThrow(
      /images\/namelayer-icons\.json references images\/missing\.png/i,
    );
  });

  test("rewrites BMFont XML page filenames to hashed relative paths", async () => {
    const { resourcesDir, outDir } = await createTempResources();

    await writeBitmapFontFixture(
      resourcesDir,
      path.join("fonts", "test.xml"),
      "test.png",
    );

    const assetManifest = buildPublicAssetManifest([resourcesDir]);
    createHashedPublicAssetFiles([resourcesDir], outDir, assetManifest);

    const xmlHref = assetManifest["fonts/test.xml"];
    const pngHref = assetManifest["fonts/test.png"];
    const emittedXml = await emitHashedAsset(outDir, xmlHref);

    expect(emittedXml).toContain(
      getExpectedRelativeEmittedPath(xmlHref, pngHref),
    );
    expect(emittedXml).not.toContain('file="test.png"');
  });

  test("BMFont XML hash changes when a referenced page image changes", async () => {
    const { resourcesDir } = await createTempResources();

    await writeBitmapFontFixture(
      resourcesDir,
      path.join("fonts", "test.xml"),
      "test.png",
    );

    const firstManifest = buildPublicAssetManifest([resourcesDir]);

    await fs.writeFile(path.join(resourcesDir, "fonts", "test.png"), "png-v2");
    clearPublicAssetManifestCache();

    const secondManifest = buildPublicAssetManifest([resourcesDir]);

    expect(firstManifest["fonts/test.png"]).not.toBe(
      secondManifest["fonts/test.png"],
    );
    expect(firstManifest["fonts/test.xml"]).not.toBe(
      secondManifest["fonts/test.xml"],
    );
  });

  test("fails when BMFont XML references a missing page image", async () => {
    const { resourcesDir } = await createTempResources();

    await fs.mkdir(path.join(resourcesDir, "fonts"), { recursive: true });
    await fs.writeFile(
      path.join(resourcesDir, "fonts", "broken.xml"),
      [
        '<?xml version="1.0"?>',
        "<font>",
        '  <pages><page id="0" file="missing.png"/></pages>',
        "</font>",
        "",
      ].join("\n"),
    );

    expect(() => buildPublicAssetManifest([resourcesDir])).toThrow(
      /missing from the asset manifest/i,
    );
  });

  test("rewrites nested BMFont page references to the correct relative hashed path", async () => {
    const { resourcesDir, outDir } = await createTempResources();

    await writeBitmapFontFixture(
      resourcesDir,
      path.join("fonts", "nested", "atlas.xml"),
      path.join("pages", "p0.png"),
      "nested-png",
    );

    const assetManifest = buildPublicAssetManifest([resourcesDir]);
    createHashedPublicAssetFiles([resourcesDir], outDir, assetManifest);

    const xmlHref = assetManifest["fonts/nested/atlas.xml"];
    const pngHref = assetManifest["fonts/nested/pages/p0.png"];
    const emittedXml = await emitHashedAsset(outDir, xmlHref);

    expect(emittedXml).toContain(
      getExpectedRelativeEmittedPath(xmlHref, pngHref),
    );
    expect(emittedXml).not.toContain('file="pages/p0.png"');
  });
});
