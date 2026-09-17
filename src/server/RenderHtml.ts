import ejs from "ejs";
import type { Response } from "express";
import fs from "fs/promises";
import { buildAssetUrl, type AssetManifest } from "../core/AssetUrls";
import type { ClusterConfig } from "../core/ClusterConfig";
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

/**
 * The values the page carries into the bundle as `window.BOOTSTRAP_CONFIG`.
 *
 * Structurally the same shape as the `Window["BOOTSTRAP_CONFIG"]` declaration
 * in src/core/configuration/Config.ts (checked below), minus `numWorkers`,
 * which only legacy desktop shells inject and no server has emitted since the
 * cluster map replaced it.
 *
 * Optional fields are OMITTED when absent, never set to undefined: the
 * template drops the whole line for an absent local, and the desktop
 * descriptor serialises this object as JSON, where an undefined value would
 * silently vanish anyway. Keeping the two behaviours identical is what lets
 * the same object back both.
 */
export interface BootstrapConfig {
  gitCommit: string;
  assetManifest: AssetManifest;
  cdnBase: string;
  gameEnv: string;
  cluster?: ClusterConfig;
  instanceLetter?: string;
  turnstileSiteKey: string;
  jwtAudience: string;
  stripePublishableKey?: string;
  instanceId?: string;
  serverHost?: string;
  siteHost?: string;
}

// Compile-time only: every field here must be one the client declares, with a
// compatible type. Adding a field to BootstrapConfig without declaring it on
// window.BOOTSTRAP_CONFIG is a type error here rather than a silent `any` on
// the client.
const _bootstrapConfigMatchesClient: NonNullable<Window["BOOTSTRAP_CONFIG"]> =
  {} as BootstrapConfig;
void _bootstrapConfigMatchesClient;

export interface BuildBootstrapConfigOptions {
  /** Same meaning as {@link RenderHtmlOptions.perServer}. */
  perServer: boolean;
  assetManifest: AssetManifest;
  cdnBase: string;
}

/**
 * THE list of BOOTSTRAP_CONFIG fields and where each comes from. Everything
 * that emits the config derives from this one function -- renderHtmlContent
 * for the page (each field becomes its own template local, plus the whole
 * object as `bootstrapConfig`), and DesktopRelease.buildDescriptor for the
 * environment-only `bootstrap` the Steam shell spreads into its own render --
 * so a field added here reaches every consumer, and a field added anywhere
 * else reaches none.
 *
 * With perServer false this reads only the build and environment values and
 * never touches CLUSTER_JSON; see RenderHtmlOptions.perServer for why.
 */
export function buildBootstrapConfig(
  opts: BuildBootstrapConfigOptions,
): BootstrapConfig {
  const config: BootstrapConfig = {
    gitCommit: ServerEnv.gitCommit(),
    assetManifest: opts.assetManifest,
    cdnBase: opts.cdnBase,
    gameEnv: ServerEnv.gameEnvName(),
    turnstileSiteKey: ServerEnv.turnstileSiteKey(),
    jwtAudience: ServerEnv.jwtAudience(),
  };
  // Environment-scoped like the two above (so the static per-version page and
  // the desktop descriptor carry it too), but optional: absent when the
  // deployment has no key, and the guarded template line then drops out.
  const stripePublishableKey = ServerEnv.stripePublishableKey();
  if (stripePublishableKey !== undefined) {
    config.stripePublishableKey = stripePublishableKey;
  }
  if (!opts.perServer) return config;

  // The fleet map plus which entry is this server. Replaces the old
  // numWorkers scalar: the client derives its own-server worker count from
  // cluster[instanceLetter], and routes foreign game ids by their leading
  // letter.
  config.cluster = ServerEnv.cluster();
  config.instanceLetter = ServerEnv.instanceLetter();
  // Always present in a full render, even as "": ClientEnv treats a missing
  // instanceId as a missing BOOTSTRAP_CONFIG.
  config.instanceId = ServerEnv.instanceId();
  // The GAME host: the name this deployment answers sockets and /api on, which
  // is not the host the page came from whenever something else owns that (a
  // load balancer on prod, the static Worker on a dev deployment with
  // GAME_DOMAIN). Pinning the tab to it is what keeps a game alive across a
  // balancer flip.
  const serverHost = ServerEnv.publicHost();
  if (serverHost !== undefined) config.serverHost = serverHost;
  // The load-balancer apex, when this deployment sits behind one. The client
  // uses it as the unknown-letter redirect target -- the apex shell always
  // carries the freshest cluster map. Absent for standalone deployments (beta,
  // branch previews, dev), which have no apex to bounce to and fall through to
  // their normal not-found flow.
  const siteHost = ServerEnv.siteHost();
  if (siteHost !== undefined) config.siteHost = siteHost;
  return config;
}

export async function renderHtmlContent(
  htmlPath: string,
  opts: RenderHtmlOptions = {},
): Promise<string> {
  const perServer = opts.perServer ?? true;
  const htmlContent = await fs.readFile(htmlPath, "utf-8");
  const assetManifest = await getRuntimeAssetManifest();
  const cdnBase = ServerEnv.cdnBase();
  const bootstrapConfig = buildBootstrapConfig({
    perServer,
    assetManifest,
    cdnBase,
  });
  // One template local per field, each the JSON literal the page embeds. A
  // field the config omits is omitted here too (not set to a falsy string):
  // the template guards each optional one with `typeof x !== "undefined" &&
  // x`, so an absent local drops the whole line, indentation and trailing
  // comma included.
  const fieldLocals: Record<string, string> = {};
  for (const [key, value] of Object.entries(bootstrapConfig)) {
    fieldLocals[key] = JSON.stringify(value);
  }
  return ejs.render(htmlContent, {
    ...fieldLocals,
    // The whole object as one JSON literal. Unused by today's template, which
    // still spells out each field; the planned single-placeholder template
    // (`window.BOOTSTRAP_CONFIG = <%- bootstrapConfig %>;`) reads this once
    // the desktop shell that supplies it has shipped.
    bootstrapConfig: JSON.stringify(bootstrapConfig),
    // Raw (unquoted) value for use as a URL prefix in the index.html template,
    // e.g. <script src="<%- cdnBaseRaw %>/assets/index-XXX.js">. The Vite
    // build plugin inject-cdn-base-template rewrites Vite's emitted /assets/
    // refs to use this placeholder.
    cdnBaseRaw: cdnBase,
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
