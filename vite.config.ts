import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";
import { viteStaticCopy } from "vite-plugin-static-copy";
import tsconfigPaths from "vite-tsconfig-paths";
import wasm from "vite-plugin-wasm";

// Vite already handles these, but its good practice to define them explicitly
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProduction = mode === "production";

  const vitePort = parseInt(process.env.VITE_PORT ?? "9000", 10);
  const masterPort = parseInt(process.env.MASTER_PORT ?? "3000", 10);
  const workerBasePort = parseInt(
    process.env.WORKER_BASE_PORT ?? String(masterPort + 1),
    10,
  );
  const controlPlanePort = parseInt(process.env.CONTROL_PLANE_PORT ?? "0", 10);
  const controlPlaneMode = (
    process.env.CONTROL_PLANE_MODE ?? "proxy"
  ).toLowerCase();
  const useControlPlaneProxy =
    Number.isFinite(controlPlanePort) && controlPlanePort > 0;
  const useControlPlaneWorkerProxy =
    useControlPlaneProxy &&
    controlPlaneMode !== "standalone" &&
    controlPlaneMode !== "masterless";
  const proxyHttpTarget = useControlPlaneProxy
    ? `http://localhost:${controlPlanePort}`
    : `http://localhost:${masterPort}`;
  const proxyWsTarget = useControlPlaneProxy
    ? `ws://localhost:${controlPlanePort}`
    : `ws://localhost:${masterPort}`;

  const workerProxyTarget = (workerIndex: number) =>
    useControlPlaneWorkerProxy
      ? `ws://localhost:${controlPlanePort}`
      : `ws://localhost:${workerBasePort + workerIndex}`;
  const workerProxyRewrite = (workerIndex: number) =>
    useControlPlaneWorkerProxy
      ? (path: string) => path
      : (path: string) => path.replace(new RegExp(`^/w${workerIndex}`), "");

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
        "wasm-core": path.resolve(__dirname, "rust/wasm-core/pkg"),
        "dioxus-ui": path.resolve(__dirname, "rust/dioxus-ui/pkg"),
      },
    },

    plugins: [
      wasm(),
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
                },
              },
            }),
          ]),
      viteStaticCopy({
        targets: [
          {
            src: "proprietary/*",
            dest: ".",
          },
        ],
      }),
      tailwindcss(),
    ],

    define: {
      "process.env.WEBSOCKET_URL": JSON.stringify(
        isProduction ? "" : `localhost:${masterPort}`,
      ),
      "process.env.GAME_ENV": JSON.stringify(isProduction ? "prod" : "dev"),
      "process.env.STRIPE_PUBLISHABLE_KEY": JSON.stringify(
        env.STRIPE_PUBLISHABLE_KEY,
      ),
      "process.env.API_DOMAIN": JSON.stringify(env.API_DOMAIN),
      // Add other process.env variables if needed, OR migrate code to import.meta.env
    },

    worker: {
      format: "es",
      plugins: () => [wasm()],
    },

    build: {
      outDir: "static", // Webpack outputs to 'static', assuming we want to keep this.
      emptyOutDir: true,
      assetsDir: "assets", // Sub-directory for assets
      target: "esnext", // Required for top-level await in workers
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["pixi.js", "howler", "zod", "protobufjs"],
          },
        },
      },
    },

    server: {
      port: vitePort,
      // Automatically open the browser when the server starts
      open: process.env.SKIP_BROWSER_OPEN !== "true",
      proxy: {
        "/lobbies": {
          target: proxyWsTarget,
          ws: true,
          changeOrigin: true,
        },
        "/matchmaking": {
          target: proxyWsTarget,
          ws: true,
          changeOrigin: true,
          secure: false,
        },
        // Worker proxies
        "/w0": {
          target: workerProxyTarget(0),
          ws: true,
          secure: false,
          changeOrigin: true,
          rewrite: workerProxyRewrite(0),
        },
        "/w1": {
          target: workerProxyTarget(1),
          ws: true,
          secure: false,
          changeOrigin: true,
          rewrite: workerProxyRewrite(1),
        },
        "/w2": {
          target: workerProxyTarget(2),
          ws: true,
          secure: false,
          changeOrigin: true,
          rewrite: workerProxyRewrite(2),
        },
        // API proxies
        "/api": {
          target: proxyHttpTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
