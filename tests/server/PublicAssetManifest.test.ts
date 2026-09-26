import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, test } from "vitest";
import { normalizeAssetPath } from "../../src/core/AssetUrls";
import {
  buildPublicAssetManifest,
  buildRootFilesIndex,
  clearPublicAssetManifestCache,
  copyRootPublicFiles,
  createHashedPublicAssetFiles,
  getPublicDir,
  writeRootFilesIndex,
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
    expect(firstOutput).toContain(
      getExpectedRelativeEmittedPath(firstManifestHref, firstIconHref),
    );
    expect(firstOutput).not.toContain(
      getExpectedRelativeEmittedPath(firstManifestHref, secondIconHref),
    );
  });

  test("rewrites root-relative web manifest icon paths to hashed paths relative to the manifest", async () => {
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

    const manifestHref = assetManifest["manifest.json"];
    const iconHref = assetManifest["icons/app-icon.png"];
    const emittedManifest = JSON.parse(
      await emitHashedAsset(outDir, manifestHref),
    ) as { icons: Array<{ src: string }> };

    // The manifest is served under the CDN prefix (/game_assets/_assets/...),
    // and the browser resolves icon srcs against the manifest URL, so a
    // root-relative /_assets/... src would escape the prefix and 404.
    const iconSrc = emittedManifest.icons[0].src;
    expect(iconSrc).toBe(
      getExpectedRelativeEmittedPath(manifestHref, iconHref),
    );
    expect(iconSrc).toMatch(/^icons\/app-icon\.[0-9a-f]{12}\.png$/);
    expect(iconSrc).not.toMatch(/^\//);
    expect(iconSrc).not.toContain("_assets/");
    expect(iconSrc).not.toBe("/icons/app-icon.png");
  });

  test("rewrites nested web manifest icon paths relative to the manifest", async () => {
    const { resourcesDir, outDir } = await createTempResources();

    await fs.mkdir(path.join(resourcesDir, "icons", "pwa"), {
      recursive: true,
    });
    await writeWebManifestFixture(resourcesDir, [
      { src: "icons/pwa/maskable.png" },
    ]);
    await fs.writeFile(
      path.join(resourcesDir, "icons", "pwa", "maskable.png"),
      "icon-v1",
      "utf8",
    );

    const assetManifest = buildPublicAssetManifest([resourcesDir]);
    createHashedPublicAssetFiles([resourcesDir], outDir, assetManifest);

    const manifestHref = assetManifest["manifest.json"];
    const iconHref = assetManifest["icons/pwa/maskable.png"];
    const emittedManifest = JSON.parse(
      await emitHashedAsset(outDir, manifestHref),
    ) as { icons: Array<{ src: string }> };

    const iconSrc = emittedManifest.icons[0].src;
    expect(iconSrc).toBe(
      getExpectedRelativeEmittedPath(manifestHref, iconHref),
    );
    expect(iconSrc).toMatch(/^icons\/pwa\/maskable\.[0-9a-f]{12}\.png$/);
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

  test("copies resources/public/ verbatim to the site root, dot-directories included", async () => {
    const { resourcesDir, outDir } = await createTempResources();
    const publicDir = getPublicDir(resourcesDir);
    await fs.mkdir(path.join(publicDir, "press", "images"), {
      recursive: true,
    });
    await fs.mkdir(path.join(publicDir, ".well-known"), { recursive: true });
    await fs.writeFile(path.join(publicDir, "press", "index.html"), "press");
    await fs.writeFile(path.join(publicDir, "press", "images", "a.png"), "png");
    await fs.writeFile(path.join(publicDir, ".well-known", "apple"), "apple");
    await fs.writeFile(path.join(publicDir, ".DS_Store"), "junk");

    copyRootPublicFiles(publicDir, outDir);

    await expect(
      fs.readFile(path.join(outDir, "press", "images", "a.png"), "utf8"),
    ).resolves.toBe("png");
    await expect(
      fs.readFile(path.join(outDir, ".well-known", "apple"), "utf8"),
    ).resolves.toBe("apple");
    await expect(fs.access(path.join(outDir, ".DS_Store"))).rejects.toThrow();
  });

  test("indexes every root file's content type, with directory entries", async () => {
    const { resourcesDir, outDir } = await createTempResources();
    const publicDir = getPublicDir(resourcesDir);
    await fs.mkdir(path.join(publicDir, "press"), { recursive: true });
    await fs.mkdir(path.join(publicDir, ".well-known"), { recursive: true });
    await fs.writeFile(path.join(publicDir, "privacy-policy.html"), "p");
    await fs.writeFile(path.join(publicDir, "index.html"), "not a dir entry");
    await fs.writeFile(path.join(publicDir, "press", "index.html"), "press");
    await fs.writeFile(path.join(publicDir, "press", "Kit 1.png"), "png");
    await fs.writeFile(path.join(publicDir, ".well-known", "apple"), "a");

    writeRootFilesIndex(publicDir, outDir);

    const html = "text/html; charset=utf-8";
    expect(
      JSON.parse(
        await fs.readFile(path.join(outDir, "root-files.json"), "utf8"),
      ),
    ).toEqual({
      ".well-known/apple": "text/plain; charset=utf-8",
      "index.html": html,
      "press/": html,
      "press/Kit 1.png": "image/png",
      "press/index.html": html,
      "privacy-policy.html": html,
    });
  });

  test("refuses a root file it has no content type for", async () => {
    const { resourcesDir } = await createTempResources();
    const publicDir = getPublicDir(resourcesDir);
    await fs.mkdir(path.join(publicDir, "press"), { recursive: true });
    await fs.writeFile(path.join(publicDir, "press", "kit.xyz"), "?");
    expect(() => buildRootFilesIndex(publicDir)).toThrow(/press\/kit\.xyz/);
  });

  test("indexes the real resources/public/, policy pages included", () => {
    const index = buildRootFilesIndex(getPublicDir(path.resolve("resources")));
    expect(index["privacy-policy.html"]).toBe("text/html; charset=utf-8");
    expect(index["terms-of-service.html"]).toBe("text/html; charset=utf-8");
    expect(
      index[".well-known/apple-developer-merchantid-domain-association"],
    ).toBe("text/plain; charset=utf-8");
    expect(index["press/"]).toBe("text/html; charset=utf-8");
  });
});
