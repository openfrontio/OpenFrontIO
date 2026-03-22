import ejs from "ejs";
import type { Response } from "express";
import fs from "fs/promises";
import { buildAssetUrl, buildVersionedAssetBasePath } from "../core/AssetUrls";

export async function renderHtmlContent(htmlPath: string): Promise<string> {
  const htmlContent = await fs.readFile(htmlPath, "utf-8");
  const assetBasePath = buildVersionedAssetBasePath(process.env.GIT_COMMIT);
  return ejs.render(htmlContent, {
    gitCommit: JSON.stringify(process.env.GIT_COMMIT ?? "undefined"),
    instanceId: JSON.stringify(process.env.INSTANCE_ID ?? "undefined"),
    assetBasePath: JSON.stringify(assetBasePath),
    manifestHref: buildAssetUrl("manifest.json", assetBasePath),
    faviconHref: buildAssetUrl("images/Favicon.svg", assetBasePath),
    gameplayScreenshotUrl: buildAssetUrl(
      "images/GameplayScreenshot.png",
      assetBasePath,
    ),
    backgroundImageUrl: buildAssetUrl("images/background.webp", assetBasePath),
    desktopLogoImageUrl: buildAssetUrl("images/OpenFront.webp", assetBasePath),
    mobileLogoImageUrl: buildAssetUrl("images/OF.webp", assetBasePath),
  });
}

export function setHtmlNoCacheHeaders(res: Response): void {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("ETag", "");
  res.setHeader("Content-Type", "text/html");
}

export async function renderHtml(
  res: Response,
  htmlPath: string,
): Promise<void> {
  const rendered = await renderHtmlContent(htmlPath);
  setHtmlNoCacheHeaders(res);
  res.send(rendered);
}
