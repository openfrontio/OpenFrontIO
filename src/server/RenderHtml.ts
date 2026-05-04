import ejs from "ejs";
import type { Response } from "express";
import fs from "fs/promises";
import { buildAssetUrl } from "../core/AssetUrls";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";

const APP_SHELL_CACHE_CONTROL =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=86400";

const appShellContentCache = new Map<string, Promise<string>>();

export async function renderHtmlContent(htmlPath: string): Promise<string> {
  const htmlContent = await fs.readFile(htmlPath, "utf-8");
  const assetManifest = await getRuntimeAssetManifest();
  const cdnBase = process.env.CDN_BASE ?? "";
  return ejs.render(htmlContent, {
    gitCommit: JSON.stringify(process.env.GIT_COMMIT ?? "undefined"),
    assetManifest: JSON.stringify(assetManifest),
    cdnBase: JSON.stringify(cdnBase),
    // Raw (unquoted) value for use as a URL prefix in the index.html template,
    // e.g. <script src="<%- cdnBaseRaw %>/assets/index-XXX.js">. The Vite
    // build plugin inject-cdn-base-template rewrites Vite's emitted /assets/
    // refs to use this placeholder.
    cdnBaseRaw: cdnBase,
    gameEnv: JSON.stringify(process.env.GAME_ENV ?? "dev"),
    manifestHref: buildAssetUrl("manifest.json", assetManifest, cdnBase),
    faviconHref: buildAssetUrl("images/Favicon.svg", assetManifest, cdnBase),
    gameplayScreenshotUrl: buildAssetUrl(
      "images/GameplayScreenshot.png",
      assetManifest,
      cdnBase,
    ),
    backgroundImageUrl: buildAssetUrl(
      "images/background.webp",
      assetManifest,
      cdnBase,
    ),
    desktopLogoImageUrl: buildAssetUrl(
      "images/OpenFront.png",
      assetManifest,
      cdnBase,
    ),
    mobileLogoImageUrl: buildAssetUrl("images/OF.png", assetManifest, cdnBase),
  });
}

export async function getAppShellContent(htmlPath: string): Promise<string> {
  let cachedContent = appShellContentCache.get(htmlPath);
  if (!cachedContent) {
    cachedContent = renderHtmlContent(htmlPath).catch((error: unknown) => {
      appShellContentCache.delete(htmlPath);
      throw error;
    });
    appShellContentCache.set(htmlPath, cachedContent);
  }
  return cachedContent;
}

export function clearAppShellContentCache(): void {
  appShellContentCache.clear();
}

export function setAppShellCacheHeaders(res: Response): void {
  res.setHeader("Cache-Control", APP_SHELL_CACHE_CONTROL);
  res.setHeader("Content-Type", "text/html");
}

export function setHtmlNoCacheHeaders(res: Response): void {
  setNoStoreHeaders(res);
  res.setHeader("ETag", "");
  res.setHeader("Content-Type", "text/html");
}

export async function renderAppShell(
  res: Response,
  htmlPath: string,
): Promise<void> {
  const rendered = await getAppShellContent(htmlPath);
  // Cannot edge-cache the app shell: Cloudflare's auto-CSP rotates the
  // nonce in the response header on every request, but a cached body
  // freezes the nonces in inline <script> tags. The mismatch blocks all
  // inline scripts (incl. Turnstile's srcdoc iframes) on cache hits.
  setHtmlNoCacheHeaders(res);
  res.send(rendered);
}
