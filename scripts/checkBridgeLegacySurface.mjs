import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BRIDGE_PATH = resolve(process.cwd(), "src/client/UiRuntimeBridge.ts");
const source = readFileSync(BRIDGE_PATH, "utf8");
const interfaceMatch = source.match(
  /export interface DioxusWasmModule \{([\s\S]*?)\n\}/,
);

if (!interfaceMatch) {
  console.error("[bridge-surface] DioxusWasmModule interface was not found");
  process.exit(1);
}

const methods = [...interfaceMatch[1].matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map(
  (entry) => entry[1],
);
const legacyMethods = methods.filter((name) =>
  /^(launch|update|show|hide)_/.test(name),
);

const rawMax = process.env.UI_RUNTIME_LEGACY_BRIDGE_MAX ?? "0";
const maxAllowed = Number.parseInt(rawMax, 10);
if (!Number.isFinite(maxAllowed) || maxAllowed < 0) {
  console.error(
    `[bridge-surface] Invalid UI_RUNTIME_LEGACY_BRIDGE_MAX: ${rawMax}`,
  );
  process.exit(1);
}

if (legacyMethods.length > maxAllowed) {
  console.error(
    `[bridge-surface] Legacy bridge methods grew to ${legacyMethods.length}; max allowed is ${maxAllowed}`,
  );
  console.error(
    `[bridge-surface] Methods: ${legacyMethods.sort((a, b) => a.localeCompare(b)).join(", ")}`,
  );
  process.exit(1);
}

console.log(
  `[bridge-surface] Legacy bridge methods: ${legacyMethods.length} (max ${maxAllowed})`,
);
