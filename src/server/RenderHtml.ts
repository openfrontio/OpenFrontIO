import ejs from "ejs";
import type { Response } from "express";
import fs from "fs/promises";
import { buildAssetUrl } from "../core/AssetUrls";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";

export async function renderHtmlContent(htmlPath: string): Promise<string> {
  const htmlContent = await fs.readFile(htmlPath, "utf-8");
  const assetManifest = await getRuntimeAssetManifest();
  return ejs.render(htmlContent, {
    gitCommit: JSON.stringify(process.env.GIT_COMMIT ?? "undefined"),
    instanceId: JSON.stringify(process.env.INSTANCE_ID ?? "undefined"),
    assetManifest: JSON.stringify(assetManifest),
    gameEnv: JSON.stringify(process.env.GAME_ENV ?? "dev"),
    manifestHref: buildAssetUrl("manifest.json", assetManifest),
    faviconHref: buildAssetUrl("images/Favicon.svg", assetManifest),
    gameplayScreenshotUrl: buildAssetUrl(
      "images/GameplayScreenshot.png",
      assetManifest,
    ),
    backgroundImageUrl: buildAssetUrl("images/background.webp", assetManifest),
    desktopLogoImageUrl: buildAssetUrl("images/OpenFront.webp", assetManifest),
    mobileLogoImageUrl: buildAssetUrl("images/OF.webp", assetManifest),
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
