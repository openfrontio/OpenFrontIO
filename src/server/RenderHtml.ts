import ejs from "ejs";
import type { Response } from "express";
import fs from "fs/promises";
import { buildAssetUrl } from "../core/AssetUrls";
import { setNoStoreHeaders } from "./NoStoreHeaders";
import { getRuntimeAssetManifest } from "./RuntimeAssetManifest";
import { ServerEnv } from "./ServerEnv";

const APP_SHELL_CACHE_CONTROL =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400";

const appShellContentCache = new Map<string, Promise<string>>();

export interface RenderHtmlOptions {
  /**
   * Inject the values that only make sense for ONE running server: `cluster`,
   * `instanceLetter`, `instanceId`, `serverHost`, `siteHost`.
   *
   * True (the default) is what a game server serves and what the legacy
   * `index-<short>.html` replay shell is rendered with — byte-for-byte what
   * this function has always produced.
   *
   * False produces an environment-only page: everything that depends on the
   * BUILD and the ENVIRONMENT (gitCommit, assetManifest, cdnBase, gameEnv,
   * turnstileSiteKey, jwtAudience) and nothing that depends on which server
   * happens to render it. That page is uploaded once per version to
   * `sites/<site>/v/<short>/index.html` and served by the static Worker to
   * every player of that version, which is only sound if it names no server —
   * the client asks the API for the server list instead (see
   * docs/MultiServer.md, "Server list v2").
   *
   * Rendering with perServer false also avoids reading CLUSTER_JSON at all, so
   * the page can be produced without a valid cluster entry for this host.
   */
  perServer?: boolean;
}

export async function renderHtmlContent(
  htmlPath: string,
  opts: RenderHtmlOptions = {},
): Promise<string> {
  const perServer = opts.perServer ?? true;
  const htmlContent = await fs.readFile(htmlPath, "utf-8");
  const assetManifest = await getRuntimeAssetManifest();
  const cdnBase = ServerEnv.cdnBase();
  // Omitted entirely (not set to a falsy string) when perServer is false: the
  // template guards each of these with `typeof x !== "undefined" && x`, so an
  // absent local drops the whole line, indentation and trailing comma
  // included.
  const perServerLocals = perServer
    ? {
        // The fleet map plus which entry is this server. Replaces the old
        // numWorkers scalar: the client derives its own-server worker count
        // from cluster[instanceLetter], and (PR 5) routes foreign game ids by
        // their leading letter.
        cluster: JSON.stringify(ServerEnv.cluster()),
        instanceLetter: JSON.stringify(ServerEnv.instanceLetter()),
        instanceId: JSON.stringify(ServerEnv.instanceId()),
        serverHost:
          ServerEnv.publicHost() === undefined
            ? undefined
            : JSON.stringify(ServerEnv.publicHost()),
        // The load-balancer apex, when this deployment sits behind one. The
        // client uses it as the unknown-letter redirect target — the apex shell
        // always carries the freshest cluster map. Absent for standalone
        // deployments (beta, branch previews, dev), which have no apex to
        // bounce to and fall through to their normal not-found flow.
        siteHost:
          ServerEnv.siteHost() === undefined
            ? undefined
            : JSON.stringify(ServerEnv.siteHost()),
      }
    : {};
  return ejs.render(htmlContent, {
    ...perServerLocals,
    gitCommit: JSON.stringify(ServerEnv.gitCommit()),
    assetManifest: JSON.stringify(assetManifest),
    cdnBase: JSON.stringify(cdnBase),
    // Raw (unquoted) value for use as a URL prefix in the index.html template,
    // e.g. <script src="<%- cdnBaseRaw %>/assets/index-XXX.js">. The Vite
    // build plugin inject-cdn-base-template rewrites Vite's emitted /assets/
    // refs to use this placeholder.
    cdnBaseRaw: cdnBase,
    gameEnv: JSON.stringify(ServerEnv.gameEnvName()),
    turnstileSiteKey: JSON.stringify(ServerEnv.turnstileSiteKey()),
    jwtAudience: JSON.stringify(ServerEnv.jwtAudience()),
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
  setAppShellCacheHeaders(res);
  res.send(rendered);
}
