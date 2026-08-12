import { defineConfig } from "vitest/config";

// E2E tests boot the real server (master + cluster workers) and talk to it
// over HTTP + WebSocket on ports 3000-3002, so they run sequentially in a
// plain node environment, separate from the unit-test config in
// vite.config.ts. Run with `npm run test:e2e` (Node) or
// `npm run test:e2e:bun` (Bun runtime for the server under test).
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    // One server at a time: the suites share fixed ports.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
