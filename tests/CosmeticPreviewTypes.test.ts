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

/**
 * Lay out the package as installed, plus `consumer.ts`, and compile it. With
 * `againstSource`, the consumer is compiled with the repo's own settings (so it
 * can import the real entry), plus strict function types.
 */
function compile(
  consumer: string,
  againstSource = false,
  checksDts = CHECKS_DTS,
  lib: string[] = ["ES2022", "DOM"],
): { ok: boolean; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cosmetic-preview-types-"));
  dirs.push(dir);
  const pkg = path.join(dir, "node_modules", "@openfront", "cosmetic-preview");
  fs.mkdirSync(pkg, { recursive: true });
  const api = fs.readFileSync(
    path.join(root, "src", "client", "cosmetic-preview", "api.ts"),
    "utf8",
  );
  fs.copyFileSync(
    path.join(root, "src", "client", "cosmetic-preview", "cardCheckTypes.ts"),
    path.join(pkg, "cardCheckTypes.d.ts"),
  );
  fs.writeFileSync(path.join(pkg, "index.d.ts"), indexDts(api));
  fs.writeFileSync(path.join(pkg, "checks.d.ts"), checksDts);
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
    JSON.stringify(againstSource ? sourceTsconfig() : standaloneTsconfig(lib)),
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

/** A host's own settings: strict, with nothing from this repo. */
function standaloneTsconfig(lib: string[]): object {
  return {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      lib,
      types: [],
      skipLibCheck: false,
    },
    files: ["consumer.ts"],
  };
}

/**
 * The repo's settings, so the real entry and its imports compile, plus strict
 * function types: without them a parameter that went from optional to
 * required would still be assignable both ways.
 */
function sourceTsconfig(): object {
  return {
    extends: path.join(root, "tsconfig.json").split(path.sep).join("/"),
    // No ambient types: the consumer needs none, and they resolve from the repo.
    compilerOptions: { noEmit: true, strictFunctionTypes: true, types: [] },
    include: [],
    files: ["consumer.ts"],
  };
}

// Each export of the declared entry (D) against the real one (R): assignable
// both ways, and identical where both sides are written out alike.
const SOURCE = path
  .join(root, "src", "client", "cosmetic-preview", "checks")
  .split(path.sep)
  .join("/");
const ANIMATION = path
  .join(root, "packages", "shared", "src", "CardBackgroundAnimation")
  .split(path.sep)
  .join("/");
const AGAINST_SOURCE = `
import type * as D from "@openfront/cosmetic-preview/checks";
import type * as R from "${SOURCE}";
import type { LayerAnimation } from "${ANIMATION}";

// Assignable both ways: real to declared, and declared to real.
declare function both<A, B>(
  toDeclared: (real: B) => A,
  toReal: (declared: A) => B,
): void;
declare const id: <T>(x: T) => T;

both<typeof D.parseCardAnimation, typeof R.parseCardAnimation>(id, id);
both<typeof D.checkCardBackground, typeof R.checkCardBackground>(id, id);
both<typeof D.isCatalogueLayerSrc, typeof R.isCatalogueLayerSrc>(id, id);
both<D.LayerSrcOptions, R.LayerSrcOptions>(id, id);
both<D.CardLayerAnimation, LayerAnimation>(id, id);
both<D.CardAnimationResult, R.CardAnimationResult>(id, id);
both<typeof D.CARD_ART_WIDTH, typeof R.CARD_ART_WIDTH>(id, id);
both<typeof D.CARD_ART_HEIGHT, typeof R.CARD_ART_HEIGHT>(id, id);
both<typeof D.MAX_SET_BYTES, typeof R.MAX_SET_BYTES>(id, id);
both<typeof D.MAX_LAYERS, typeof R.MAX_LAYERS>(id, id);

// Identical: also catches an optional member or parameter added on one side.
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
declare function same<A, B>(ok: Same<A, B>): void;
same<D.LayerSrcOptions, R.LayerSrcOptions>(true);
same<D.CardLayerAnimation, LayerAnimation>(true);
same<D.CardLayerAnimation, R.CardLayerAnimation>(true);
same<D.CardLayerAnimation["layers"][number], LayerAnimation["layers"][number]>(true);
same<Parameters<typeof D.parseCardAnimation>, Parameters<typeof R.parseCardAnimation>>(true);
same<Parameters<typeof D.isCatalogueLayerSrc>, Parameters<typeof R.isCatalogueLayerSrc>>(true);
same<Parameters<typeof D.checkCardBackground>[1 | 2], Parameters<typeof R.checkCardBackground>[1 | 2]>(true);
same<D.CardAnimationResult, R.CardAnimationResult>(true);
same<typeof D.parseCardAnimation, typeof R.parseCardAnimation>(true);
same<typeof D.checkCardBackground, typeof R.checkCardBackground>(true);
same<typeof D.isCatalogueLayerSrc, typeof R.isCatalogueLayerSrc>(true);
same<ReturnType<typeof D.checkCardBackground>, ReturnType<typeof R.checkCardBackground>>(true);
same<Parameters<typeof D.checkCardBackground>[0], Parameters<typeof R.checkCardBackground>[0]>(true);
same<typeof D.CARD_ART_WIDTH, typeof R.CARD_ART_WIDTH>(true);
same<typeof D.CARD_ART_HEIGHT, typeof R.CARD_ART_HEIGHT>(true);
same<typeof D.MAX_SET_BYTES, typeof R.MAX_SET_BYTES>(true);
same<typeof D.MAX_LAYERS, typeof R.MAX_LAYERS>(true);
`;

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

  test("a server with no DOM lib compiles against the checks entry alone", () => {
    // A Node or Worker host: lib ES2022 only, and the declarations checked.
    const result = compile(
      `
import {
  checkCardBackground,
  parseCardAnimation,
  type CardBackgroundFiles,
  type CardIssue,
} from "@openfront/cosmetic-preview/checks";

const files: CardBackgroundFiles = {
  base: {
    image: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
    type: "image/webp",
    bytes: 1,
  },
  // A decoder's Node Buffer is a Uint8Array: no cast needed.
  layers: [
    {
      effect: "pulse",
      image: { width: 1, height: 1, data: new Uint8Array(4) },
      type: "image/png",
      bytes: 1,
    },
  ],
};
const issues: CardIssue[] = checkCardBackground(files, null, {
  allowedLayerHosts: ["https://cdn.example.com"],
});
const parsed = parseCardAnimation({ kind: "layers", layers: [] });
export const out = [issues.length, parsed.ok];
`,
      false,
      CHECKS_DTS,
      ["ES2022"],
    );
    expect(result.output).toBe("");
    expect(result.ok).toBe(true);
  });

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

  test("every export matches the real entry's type, both ways", () => {
    const result = compile(AGAINST_SOURCE, true);
    expect(result.output).toBe("");
    expect(result.ok).toBe(true);
  }, 120_000);

  test.each([
    [
      "a required option",
      "  allowedLayerHosts?: readonly string[];\n}",
      "  allowedLayerHosts?: readonly string[];\n  bucket: string;\n}",
    ],
    [
      "an extra optional option",
      "  allowedLayerHosts?: readonly string[];\n}",
      "  allowedLayerHosts?: readonly string[];\n  bucket?: string;\n}",
    ],
    [
      "a required parameter",
      "  input: unknown,\n  options?: LayerSrcOptions,\n): CardAnimationResult;",
      "  input: unknown,\n  options: LayerSrcOptions,\n): CardAnimationResult;",
    ],
    [
      "a dropped parameter",
      "  animation: unknown,\n  options?: LayerSrcOptions,\n): CardIssue[];",
      "  animation: unknown,\n): CardIssue[];",
    ],
    ["a wider return", "): boolean;", "): boolean | string;"],
    ["a different constant", "MAX_LAYERS: 3;", "MAX_LAYERS: 4;"],
    ["a missing animation field", "    angle?: number;\n", ""],
  ])(
    "fails on drift: %s",
    (_, from, to) => {
      expect(CHECKS_DTS).toContain(from);
      const drifted = CHECKS_DTS.replace(from, to);
      const result = compile(AGAINST_SOURCE, true, drifted);
      expect(result.ok).toBe(false);
      expect(result.output).toContain("consumer.ts");
    },
    120_000,
  );

  test("declares every runtime export of the checks entry, and nothing else", () => {
    const declared = [
      ...CHECKS_DTS.matchAll(/^export declare (?:const|function) (\w+)/gm),
    ].map((m) => m[1]);
    expect(declared.sort()).toEqual(Object.keys(checksEntry).sort());
  });

  test("declares every export of the checks entry, types included, and nothing else", () => {
    const source = fs.readFileSync(
      path.join(root, "src", "client", "cosmetic-preview", "checks.ts"),
      "utf8",
    );
    expect(exportNames(CHECKS_DTS)).toEqual(exportNames(source));
    // The parser sees what it should: the entry's values and its types.
    expect(exportNames(source)).toEqual(
      [
        ...Object.keys(checksEntry),
        "CardAnimationResult",
        "CardBackgroundFiles",
        "CardCheckImage",
        "CardEffect",
        "CardIssue",
        "CardIssueCode",
        "CardLayerAnimation",
        "LayerSrcOptions",
      ].sort(),
    );
  });

  test("the export list notices a new type-only export", () => {
    expect(
      exportNames("export type Extra = 1;\nexport interface More {}"),
    ).toEqual(["Extra", "More"]);
    expect(exportNames('export type { A, B as C } from "./x";')).toEqual([
      "A",
      "C",
    ]);
  });
});

/**
 * The names a module exports, values and types alike, read from its text: the
 * entry's re-exports, and its own (or declared) functions, constants,
 * interfaces and types. Enough for these two files, which write exports only
 * in these forms.
 */
function exportNames(text: string): string[] {
  const names: string[] = [];
  for (const [, list] of text.matchAll(/^export (?:type )?\{([^}]*)\}/gm)) {
    for (const item of list.split(",")) {
      const name = item
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (name) names.push(name);
    }
  }
  for (const [, name] of text.matchAll(
    /^export (?:declare )?(?:function|const|interface|type) (\w+)/gm,
  )) {
    names.push(name);
  }
  return names.sort();
}
