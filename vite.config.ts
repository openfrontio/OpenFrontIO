import tailwindcss from "@tailwindcss/vite";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";
import { viteStaticCopy } from "vite-plugin-static-copy";
import tsconfigPaths from "vite-tsconfig-paths";

// Vite already handles these, but its good practice to define them explicitly
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let gitCommit = process.env.GIT_COMMIT;

if (!gitCommit) {
  try {
    gitCommit = execSync("git rev-parse HEAD").toString().trim();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to determine git commit:", error.message);
    }
    gitCommit = "unknown";
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProduction = mode === "production";

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
      createHtmlPlugin({
        minify: isProduction,
        entry: "/src/client/Main.ts",
        template: "index.html",
        inject: {
          data: {
            serverConfig: JSON.stringify({
              gameEnv: isProduction ? env.GAME_ENV : "Dev",
              numWorkers: isProduction ? parseInt(env.NUM_WORKERS, 10) : 2,
              gitCommit: isProduction ? env.GIT_COMMIT : "DEV",
            }),
          },
        },
      }),
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
          rewrite: (path) => path.replace(/^\/w0/, ""),
        },
        "/w1": {
          target: "ws://localhost:3002",
          ws: true,
          secure: false,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/w1/, ""),
        },
        "/w2": {
          target: "ws://localhost:3003",
          ws: true,
          secure: false,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/w2/, ""),
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
