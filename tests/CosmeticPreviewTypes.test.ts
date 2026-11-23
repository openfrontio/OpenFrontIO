import { execFileSync } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { CHECKS_DTS, indexDts } from "../scripts/cosmeticPreviewTypes";
import * as checksEntry from "../src/client/cosmetic-preview/checks";

// The package's hand-written declarations, as the build writes them, with a
// tiny TypeScript host compiled against them: what a host like OpenDash sees.

const root = path.resolve(__dirname, "..");
const tsc = path.join(
  path.dirname(createRequire(__filename).resolve("typescript/package.json")),
  "bin",
  "tsc",
);
const dirs: string[] = [];

/** Lay out the package as installed, plus `consumer.ts`, and compile it. */
function compile(consumer: string): { ok: boolean; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cosmetic-preview-types-"));
  dirs.push(dir);
  const pkg = path.join(dir, "node_modules", "@openfront", "cosmetic-preview");
  fs.mkdirSync(pkg, { recursive: true });
  const api = fs.readFileSync(
    path.join(root, "src", "client", "cosmetic-preview", "api.ts"),
    "utf8",
  );
  fs.writeFileSync(path.join(pkg, "index.d.ts"), indexDts(api));
  fs.writeFileSync(path.join(pkg, "checks.d.ts"), CHECKS_DTS);
  fs.writeFileSync(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: "@openfront/cosmetic-preview",
      type: "module",
      exports: {
        ".": { types: "./index.d.ts", import: "./index.js" },
        "./checks": { types: "./checks.d.ts", import: "./checks.js" },
      },
    }),
  );
  fs.writeFileSync(path.join(dir, "consumer.ts"), consumer);
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2022", "DOM"],
        types: [],
        skipLibCheck: false,
      },
      files: ["consumer.ts"],
    }),
  );
  try {
    const output = execFileSync(process.execPath, [tsc, "-p", dir], {
      encoding: "utf8",
    });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("the published checks.d.ts", () => {
  test("a TS host can pass allowedLayerHosts to every src check", () => {
    const result = compile(`
import {
  type CardAnimationResult,
  type LayerSrcOptions,
  checkCardBackground,
  isCatalogueLayerSrc,
  parseCardAnimation,
} from "@openfront/cosmetic-preview/checks";
import type { CardBackgroundFiles, CardIssue } from "@openfront/cosmetic-preview";

declare const files: CardBackgroundFiles;
const options: LayerSrcOptions = { allowedLayerHosts: ["https://cdn.example.com"] };
const readonlyHosts: LayerSrcOptions = { allowedLayerHosts: ["a"] as const };

const issues: CardIssue[] = checkCardBackground(files, {}, options);
const issuesDefault: CardIssue[] = checkCardBackground(files, {});
const parsed: CardAnimationResult = parseCardAnimation({}, options);
const parsedDefault: CardAnimationResult = parseCardAnimation({});
const ok: boolean = isCatalogueLayerSrc("x.png", options) && isCatalogueLayerSrc("x.png");
if (parsed.ok) parsed.animation.layers.map((l) => l.src.length);
export { issues, issuesDefault, parsedDefault, ok, readonlyHosts };
`);
    expect(result.output).toBe("");
    expect(result.ok).toBe(true);
  }, 60_000);

  test("the option is typed, not any", () => {
    const result = compile(`
import { checkCardBackground } from "@openfront/cosmetic-preview/checks";
import type { CardBackgroundFiles } from "@openfront/cosmetic-preview";
declare const files: CardBackgroundFiles;
checkCardBackground(files, {}, { allowedLayerHosts: "https://cdn.example.com" });
`);
    expect(result.ok).toBe(false);
    expect(result.output).toContain(
      "error TS2322: Type 'string' is not assignable to type 'readonly string[]'",
    );
  }, 60_000);

  test("declares every runtime export of the checks entry, and nothing else", () => {
    const declared = [
      ...CHECKS_DTS.matchAll(/^export declare (?:const|function) (\w+)/gm),
    ].map((m) => m[1]);
    expect(declared.sort()).toEqual(Object.keys(checksEntry).sort());
  });
});
