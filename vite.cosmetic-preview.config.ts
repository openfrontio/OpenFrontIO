// Library build of the store's cosmetic preview for other OpenFront apps
// (src/client/cosmetic-preview). Run through scripts/buildCosmeticPreview.ts,
// which also ships the assets, types and package.json around this output.
//
// Kept apart from vite.config.ts on purpose: that config bakes the game's own
// asset manifest in with `define`, while this bundle must leave assetUrl() to
// read the manifest its host configures at runtime.

import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  publicDir: false,
  resolve: {
    tsconfigPaths: true,
    alias: {
      resources: path.resolve(__dirname, "resources"),
    },
  },
  plugins: [tailwindcss()],
  // A host bundler does not replace these for code in node_modules, and
  // `process` does not exist in a browser.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.GAME_ENV": JSON.stringify("prod"),
    "process.env.WEBSOCKET_URL": JSON.stringify(""),
    "process.env.API_DOMAIN": JSON.stringify(""),
  },
  build: {
    outDir: "dist/cosmetic-preview",
    emptyOutDir: true,
    copyPublicDir: false,
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, "src/client/cosmetic-preview/index.ts"),
      formats: ["es"],
      fileName: "index",
      cssFileName: "style",
    },
  },
});
