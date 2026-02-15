import { defineConfig } from "vite";

export default defineConfig({
  root: "./",
  base: "/",
  build: {
    outDir: "static",
    emptyOutDir: true,
  },
  server: {
    port: 9100,
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
    },
  },
});
