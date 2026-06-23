import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import http from "http";
import { lookup as lookupMime } from "mrmime";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";
import {
  type AssetManifest,
  buildAssetUrl,
  rewriteAssetsForCdn,
} from "./src/core/AssetUrls";
import {
  buildPublicAssetManifest,
  copyRootPublicFiles,
  createHashedPublicAssetFiles,
  getProprietaryDir,
  getResourcesDir,
  writePublicAssetManifest,
} from "./src/server/PublicAssetManifest";

// Vite already handles these, but its good practice to define them explicitly
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function serveProprietaryDir(
  proprietaryDir: string,
  resourcesDir: string,
): Plugin {
  return {
    name: "serve-proprietary-dir",
    configureServer(server) {
      // Must run before Vite's htmlFallback; skip when resources/ has the file
      // so publicDir keeps precedence.
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const rel = decodeURIComponent(
          new URL(req.url, "http://x").pathname,
        ).replace(/^\//, "");
        if (rel.includes("..")) return next();
        if (fs.existsSync(path.join(resourcesDir, rel))) return next();
        const filePath = path.join(proprietaryDir, rel);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
          return next();
        const mime = lookupMime(filePath);
        if (mime) res.setHeader("Content-Type", mime);
        res.setHeader("Cache-Control", "no-store");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

// Dev-only stand-in for the nginx random-worker routing (the openfront_workers
// upstream). Forwards these prefix-less POSTs to a randomly chosen worker port
// so the worker can mint a self-owned id. Runs as direct middleware (before
// vite's /api proxy).
const RANDOM_WORKER_PATHS = ["/api/create_game", "/api/adminbot/create_game"];
function randomWorkerCreateProxy(numWorkers: number): Plugin {
  return {
    name: "random-worker-create-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "POST") return next();
        const path = (req.url ?? "").split("?")[0];
        if (!RANDOM_WORKER_PATHS.includes(path)) return next();
        const port = 3001 + Math.floor(Math.random() * numWorkers);
        const proxyReq = http.request(
          {
            host: "localhost",
            port,
            path,
            method: "POST",
            headers: req.headers,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
          },
        );
        proxyReq.on("error", (err) => {
          res.statusCode = 502;
          res.end(`create proxy error: ${err.message}`);
        });
        req.pipe(proxyReq);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProduction = mode === "production";
  const devNumWorkers = parseInt(env.NUM_WORKERS ?? "2", 10);
  const resourcesDir = getResourcesDir(__dirname);
  const proprietaryDir = getProprietaryDir(__dirname);
  const sourceDirs = [resourcesDir, proprietaryDir];
  const assetManifest: AssetManifest = isProduction
    ? buildPublicAssetManifest(sourceDirs)
    : {};
  const cdnBase = env.CDN_BASE ?? "";
  const htmlAssetData = {
    assetManifest: JSON.stringify(assetManifest),
    cdnBase: JSON.stringify(cdnBase),
    gameEnv: JSON.stringify(env.GAME_ENV ?? "dev"),
    numWorkers: JSON.stringify(parseInt(env.NUM_WORKERS ?? "2", 10)),
    turnstileSiteKey: JSON.stringify(
      env.TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA",
    ),
    jwtAudience: JSON.stringify(env.DOMAIN ?? "localhost"),
    instanceId: JSON.stringify(env.INSTANCE_ID ?? "DEV_ID"),
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
  };

  // Vite's HTML transform replaces the source <script src="/src/client/Main.ts">
  // with the hashed bundle URL and injects <link rel="modulepreload"> /
  // <link rel="stylesheet"> tags. rewriteAssetsForCdn rewrites those refs to
  // an EJS placeholder so RenderHtml.ts can prefix them with CDN_BASE at
  // request time.
  const injectCdnBaseTemplate = (): Plugin => ({
    name: "inject-cdn-base-template",
    apply: "build" as const,
    enforce: "post",
    transformIndexHtml: rewriteAssetsForCdn,
  });

  let viteBundleFiles: string[] = [];
  const syncHashedPublicAssets = (): Plugin => ({
    name: "sync-hashed-public-assets",
    apply: "build" as const,
    writeBundle(_options, bundle) {
      viteBundleFiles = Object.keys(bundle);
    },
    closeBundle() {
      const outDir = path.join(__dirname, "static");
      copyRootPublicFiles(resourcesDir, outDir);
      // Run the source→hashed copy first; createHashedPublicAssetFiles iterates
      // assetManifest and expects every key to resolve to a file in resources/
      // or proprietary/. Vite's bundle output (assets/...) doesn't, so it's
      // merged in after.
      createHashedPublicAssetFiles(sourceDirs, outDir, assetManifest);
      // Track Vite's own bundle output (vendor chunks, JS, CSS, workers under
      // static/assets/) in the manifest so the deploy-time R2 upload covers
      // them alongside the hashed source assets. Skip non-assets/ emits like
      // index.html — those are served by the app, not from R2.
      for (const fileName of viteBundleFiles) {
        if (!fileName.startsWith("assets/")) continue;
        assetManifest[fileName] = `/${fileName}`;
      }
      writePublicAssetManifest(outDir, assetManifest);
    },
  });

  // In dev, redirect visits to /w*/game/* to "/" so Vite serves the index.html.
  const devGameHtmlBypass = (req?: {
    url?: string;
    method?: string;
    headers?: { accept?: string | string[] };
  }) => {
    if (req?.method !== "GET") return undefined;
    const accept = req.headers?.accept;
    const acceptValue = Array.isArray(accept)
      ? accept.join(",")
      : (accept ?? "");
    if (!acceptValue.includes("text/html")) return undefined;
    if (!req.url) return undefined;
    if (/^\/w\d+\/game\/[^/]+/.test(req.url)) {
      return "/";
    }
    return undefined;
  };

  return {
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./tests/setup.ts",
    },
    root: "./",
    base: "/",
    publicDir: isProduction ? false : "resources",

    resolve: {
      tsconfigPaths: true,
      alias: {
        resources: path.resolve(__dirname, "resources"),
      },
    },

    plugins: [
      ...(!isProduction
        ? [
            serveProprietaryDir(proprietaryDir, resourcesDir),
            randomWorkerCreateProxy(devNumWorkers),
          ]
        : []),
      ...(isProduction
        ? []
        : [
            createHtmlPlugin({
              minify: false,
              entry: "/src/client/Main.ts",
              template: "index.html",
              inject: {
                data: {
                  gitCommit: JSON.stringify("DEV"),
                  ...htmlAssetData,
                },
              },
            }),
          ]),
      ...(isProduction
        ? [injectCdnBaseTemplate(), syncHashedPublicAssets()]
        : []),
      tailwindcss(),
    ],

    define: {
      __ASSET_MANIFEST__: JSON.stringify(assetManifest),
      "process.env.WEBSOCKET_URL": JSON.stringify(
        isProduction ? "" : "localhost:3000",
      ),
      "process.env.GAME_ENV": JSON.stringify(isProduction ? "prod" : "dev"),
      "process.env.STRIPE_PUBLISHABLE_KEY": JSON.stringify(
        env.STRIPE_PUBLISHABLE_KEY,
      ),
      "process.env.API_DOMAIN": JSON.stringify(env.API_DOMAIN),
      // Add other process.env variables if needed, OR migrate code to import.meta.env
    },

    build: {
      outDir: "static", // Webpack outputs to 'static', assuming we want to keep this.
      emptyOutDir: true,
      assetsDir: "assets", // Sub-directory for assets
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            const vendorModules = ["pixi.js", "howler", "zod"];
            if (vendorModules.some((module) => id.includes(module))) {
              return "vendor";
            }
          },
        },
      },
    },

    server: {
      port: 9000,
      host: process.env.VITE_HOST === "lan",
      // Automatically open the browser when the server starts
      open: process.env.SKIP_BROWSER_OPEN !== "true",
      proxy: {
        "/lobbies": {
          target: "ws://localhost:3000",
          ws: true,
          changeOrigin: true,
        },
        // Worker proxies
        "/w0": {
          target: "ws://localhost:3001",
          ws: true,
          secure: false,
          changeOrigin: true,
          bypass: (req) => devGameHtmlBypass(req),
          rewrite: (path) => path.replace(/^\/w0/, ""),
        },
        "/w1": {
          target: "ws://localhost:3002",
          ws: true,
          secure: false,
          changeOrigin: true,
          bypass: (req) => devGameHtmlBypass(req),
          rewrite: (path) => path.replace(/^\/w1/, ""),
        },
        // API proxies
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
