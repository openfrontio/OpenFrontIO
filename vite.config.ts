import tailwindcss from "@tailwindcss/vite";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";
import { viteStaticCopy } from "vite-plugin-static-copy";
import tsconfigPaths from "vite-tsconfig-paths";
import {
  buildAssetUrl,
  buildVersionedAssetBasePath,
  normalizeAssetVersion,
} from "./src/core/AssetUrls";

// Vite already handles these, but its good practice to define them explicitly
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProduction = mode === "production";
  const assetVersion = normalizeAssetVersion(
    env.GIT_COMMIT ?? process.env.GIT_COMMIT,
  );
  const assetBasePath = buildVersionedAssetBasePath(assetVersion);
  const htmlAssetData = {
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
  };

  const rewriteVersionedManifest = () => ({
    name: "rewrite-versioned-manifest",
    apply: "build" as const,
    async closeBundle() {
      if (!assetVersion) {
        return;
      }

      const manifestPath = path.join(
        __dirname,
        "static",
        "_assets",
        assetVersion,
        "manifest.json",
      );
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
        icons?: Array<{ src?: string }>;
      };
      manifest.icons = manifest.icons?.map((icon) => ({
        ...icon,
        src: buildAssetUrl(icon.src ?? "", assetBasePath),
      }));
      await fs.writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
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
    publicDir: "resources", // Access static assets via import or explicit copy

    resolve: {
      alias: {
        "protobufjs/minimal": path.resolve(
          __dirname,
          "node_modules/protobufjs/minimal.js",
        ),
        resources: path.resolve(__dirname, "resources"),
      },
    },

    plugins: [
      tsconfigPaths(),
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
                  instanceId: JSON.stringify("DEV_ID"),
                  ...htmlAssetData,
                },
              },
            }),
          ]),
      viteStaticCopy({
        targets: [
          ...(assetVersion
            ? [
                {
                  src: "resources/**/*",
                  dest: `_assets/${assetVersion}`,
                },
              ]
            : []),
          {
            src: "proprietary/*",
            dest: ".",
          },
        ],
      }),
      ...(isProduction ? [rewriteVersionedManifest()] : []),
      tailwindcss(),
    ],

    define: {
      __ASSET_BASE_PATH__: JSON.stringify(assetBasePath),
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
          manualChunks: {
            vendor: ["pixi.js", "howler", "zod", "protobufjs"],
          },
        },
      },
    },

    server: {
      port: 9000,
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
