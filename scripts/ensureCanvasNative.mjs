#!/usr/bin/env node

import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const hasNativeCanvas = () => {
  try {
    const canvas = require("canvas");
    return typeof canvas.createCanvas === "function";
  } catch {
    return false;
  }
};

if (hasNativeCanvas()) {
  console.log("[canvas] Native bindings detected.");
  process.exit(0);
}

console.log("[canvas] Native bindings missing; running `npm rebuild canvas`.");

try {
  execSync("npm rebuild canvas", { stdio: "inherit" });
} catch {
  console.warn("[canvas] Rebuild failed; tests will use canvas mock fallback.");
  process.exit(0);
}

if (hasNativeCanvas()) {
  console.log("[canvas] Native bindings restored.");
} else {
  console.warn(
    "[canvas] Native bindings still unavailable; tests will use canvas mock fallback.",
  );
}
