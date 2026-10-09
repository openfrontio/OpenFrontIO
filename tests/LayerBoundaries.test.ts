/**
 * Enforces the import graph between the engine, its public API, the code
 * shared by client and server, and the apps (#1701, docs/EnginePackageSplit.md).
 *
 * Every file belongs to the package its directory names (packages/<pkg>/src,
 * src/client, src/server). An import edge outside the allowed graph fails
 * unless ALLOWLIST lists it; a listed edge that no longer occurs fails too,
 * so the list only shrinks.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { fileURLToPath } from "url";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Pkg =
  | "engine"
  | "engine-api"
  | "engine-lib"
  | "shared"
  | "zbin"
  | "client"
  | "server"
  | "resources";

// The only engine files the apps may load: the simulation worker for the
// client, and the winner replay for the server (src/server/WinnerReplay.ts).
const ENGINE_ENTRY = "packages/engine/src/worker/Worker.worker.ts";
const SERVER_ENGINE_ENTRY = "packages/engine/src/WinnerReplay.ts";

const ALLOWED: Record<Pkg, Pkg[]> = {
  "engine-api": ["engine-api", "zbin", "resources"],
  "engine-lib": ["engine-lib", "engine-api", "zbin", "resources"],
  engine: ["engine", "engine-lib", "engine-api", "zbin", "resources"],
  shared: ["shared", "engine-lib", "engine-api", "zbin", "resources"],
  zbin: ["zbin"],
  client: ["client", "shared", "engine-lib", "engine-api", "zbin", "resources"],
  server: ["server", "shared", "engine-lib", "engine-api", "zbin", "resources"],
  resources: [],
};

// Packages that run inside the simulation and must stay deterministic.
const ENGINE_SIDE = new Set<Pkg>(["engine", "engine-lib", "engine-api"]);

// npm dependencies the deterministic packages may use.
const ENGINE_NPM = new Set(["zod", "zod/v4"]);

/**
 * Network APIs, matched as any reference (an alias such as `const f = fetch`
 * counts). The engine is handed everything it needs: maps come in `init`.
 */
const NETWORK = /\b(fetch|XMLHttpRequest|WebSocket|importScripts)\b/g;

/**
 * Math functions the spec lets each JS engine approximate its own way, so
 * two browsers could simulate the same game differently. The rest (sqrt,
 * floor, imul...) are exact. Use engine-lib's DetMath instead.
 */
const INEXACT_MATH =
  /\bMath\.(a?cosh?|a?sinh?|a?tanh?|atan2|cbrt|exp|expm1|hypot|log|log1p|log2|log10|pow)\b/g;

/**
 * The game client: the homepage loads it only once a game is joining
 * (src/client/GameClientLoader.ts), and the store's cosmetic previews only
 * once one opens. Whatever the homepage imports statically is in its first
 * download.
 */
const GAME_CLIENT =
  /^src\/client\/((hud|view|controllers|render)\/.*|ClientGameRunner|Transport|LocalServer|InputHandler|TransformHandler|WebGLFrameBuilder|WorkerClient)\.ts$/;

/**
 * The modals the homepage loads on demand: whatever src/client/LazyModals.ts
 * imports.
 */
const LAZY_MODALS = "src/client/LazyModals.ts";

/** Renderer settings the homepage's settings screens read too. */
const HOMEPAGE_RENDER_SETTINGS = new Set([
  "src/client/render/gl/GraphicsOverrides.ts",
  "src/client/render/gl/RenderSettings.ts",
]);

/** Known violations, as "<from file> -> <to file>"; never add to it. */
const ALLOWLIST: string[] = [];

const PACKAGES: Pkg[] = [
  "engine",
  "engine-api",
  "engine-lib",
  "shared",
  "zbin",
];

function packageOf(file: string): Pkg | null {
  const m = /^packages\/([^/]+)\/src\//.exec(file);
  if (m && (PACKAGES as string[]).includes(m[1])) return m[1] as Pkg;
  if (file.startsWith("src/client/")) return "client";
  if (file.startsWith("src/server/")) return "server";
  if (file.startsWith("resources/")) return "resources";
  return null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const p = `${dir}/${ent.name}`;
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

function specifiers(file: string): string[] {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      out.push(node.argument.literal.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * The imports and re-exports left once TypeScript compiles the source: an
 * import used only as a type is erased, so it loads nothing.
 */
function runtimeSpecifiers(source: string): string[] {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;
  const sf = ts.createSourceFile("out.js", js, ts.ScriptTarget.Latest);
  return sf.statements.flatMap((s) =>
    (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) &&
    s.moduleSpecifier &&
    ts.isStringLiteral(s.moduleSpecifier)
      ? [s.moduleSpecifier.text]
      : [],
  );
}

function probe(base: string): string | null {
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}/index.ts`,
    base.replace(/\.js$/, ".ts"),
  ]) {
    const full = path.join(ROOT, cand);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return cand;
  }
  return null;
}

/** Repo-relative target of a specifier, or the npm package name. */
function resolve(
  from: string,
  spec: string,
): { file: string } | { npm: string } {
  const bare = spec.split("?")[0];
  let target: string | null;
  if (bare.startsWith(".")) {
    target = probe(path.posix.join(path.posix.dirname(from), bare));
  } else if (bare.startsWith("src/") || bare.startsWith("resources/")) {
    target = probe(bare);
  } else if (bare.startsWith("@openfront/")) {
    // Workspace packages export "./*" -> "./src/*.ts" (zbin also ".").
    const [, pkg, ...sub] = bare.split("/");
    target = probe(
      `packages/${pkg}/src/${sub.length > 0 ? sub.join("/") : "index"}`,
    );
  } else {
    return { npm: bare };
  }
  if (target === null) throw new Error(`${from}: cannot resolve "${spec}"`);
  return { file: target };
}

function violations(): {
  edges: Set<string>;
  determinism: string[];
  inexactMath: string[];
  io: string[];
} {
  const edges = new Set<string>();
  const determinism: string[] = [];
  const inexactMath: string[] = [];
  const io: string[] = [];
  const files = [
    ...PACKAGES.flatMap((pkg) => walk(`packages/${pkg}/src`)),
    ...walk("src/client"),
    ...walk("src/server"),
  ];
  for (const file of files) {
    const from = packageOf(file)!;
    for (const spec of specifiers(file)) {
      const r = resolve(file, spec);
      if ("npm" in r) {
        if (ENGINE_SIDE.has(from) && !ENGINE_NPM.has(r.npm)) {
          edges.add(`${file} -> npm:${r.npm}`);
        }
        continue;
      }
      const to = packageOf(r.file);
      if (to === null) continue;
      if (ALLOWED[from].includes(to)) continue;
      if (to === "engine" && from === "client" && r.file === ENGINE_ENTRY) {
        continue;
      }
      if (
        to === "engine" &&
        from === "server" &&
        r.file === SERVER_ENGINE_ENTRY
      ) {
        continue;
      }
      edges.add(`${file} -> ${r.file}`);
    }
    if (ENGINE_SIDE.has(from)) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      const find = (re: RegExp, out: string[]) => {
        for (const m of text.matchAll(re)) {
          const line = text.slice(0, m.index).split("\n").length;
          const src = text.split("\n")[line - 1].trim();
          if (/^(\/\/|\/\*|\*)/.test(src)) continue;
          out.push(`${file}:${line}: ${m[0]}`);
        }
      };
      find(/Math\.random|Date\.now|new Date\b/g, determinism);
      find(INEXACT_MATH, inexactMath);
      find(NETWORK, io);
    }
  }
  return { edges, determinism, inexactMath, io };
}

/**
 * The game client files and on-demand modals the homepage loads up front, each
 * as the chain of static imports from src/client/Main.ts that reaches it.
 */
function homepageOnDemandImports(): string[] {
  const ENTRY = "src/client/Main.ts";
  const lazyModals = new Set(
    [
      ...fs
        .readFileSync(path.join(ROOT, LAZY_MODALS), "utf8")
        .matchAll(/import\("([^"]+)"\)/g),
    ].flatMap((m) => {
      const r = resolve(LAZY_MODALS, m[1]);
      return "npm" in r ? [] : [r.file];
    }),
  );
  const importer = new Map<string, string>([[ENTRY, ""]]);
  const queue = [ENTRY];
  const found: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift()!;
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const spec of runtimeSpecifiers(text)) {
      const r = resolve(file, spec);
      if ("npm" in r || importer.has(r.file)) continue;
      importer.set(r.file, file);
      if (
        (GAME_CLIENT.test(r.file) && !HOMEPAGE_RENDER_SETTINGS.has(r.file)) ||
        lazyModals.has(r.file)
      ) {
        const chain = [r.file];
        for (let f = file; f !== ""; f = importer.get(f)!) chain.unshift(f);
        found.push(chain.join(" -> "));
      } else if (/\.(ts|js|mjs)$/.test(r.file)) {
        queue.push(r.file);
      }
    }
  }
  return found.sort();
}

describe("layer boundaries", () => {
  const { edges, determinism, inexactMath, io } = violations();
  const homepageOnDemand = homepageOnDemandImports();

  test("no import edges outside the allowed graph", () => {
    const allowed = new Set(ALLOWLIST);
    const unexpected = [...edges].filter((e) => !allowed.has(e)).sort();
    expect(unexpected).toEqual([]);
  });

  test("the allowlist has no stale entries", () => {
    const stale = ALLOWLIST.filter((e) => !edges.has(e));
    expect(stale).toEqual([]);
  });

  test("engine code uses no wall-clock or unseeded randomness", () => {
    expect(determinism).toEqual([]);
  });

  test("engine code uses only exactly specified Math functions", () => {
    expect(inexactMath).toEqual([]);
  });

  test("the Math check catches each approximated function", () => {
    const hits = (src: string) => [...src.matchAll(INEXACT_MATH)].length > 0;
    for (const src of [
      "Math.sin(a)",
      "Math.acosh(a)",
      "Math.atan(a)",
      "Math.atan2(y, x)",
      "Math.log1p(a)",
      "Math.pow(a, b)",
      "const f = Math.exp",
    ]) {
      expect(hits(src), src).toBe(true);
    }
    for (const src of [
      "Math.sqrt(a)",
      "Math.floor(a)",
      "Math.imul(a, b)",
      "Math.PI",
      "Math.LN2",
      "DetMath.exp(a)",
      "logger.log(a)",
    ]) {
      expect(hits(src), src).toBe(false);
    }
  });

  test("the homepage loads the game client and its modals only on demand", () => {
    expect(homepageOnDemand).toEqual([]);
  });

  test("the homepage check follows only imports that load something", () => {
    expect(
      runtimeSpecifiers(`
        import { a } from "./a";
        import { B } from "./b";
        import type { C } from "./c";
        import { type D } from "./d";
        import "./e";
        export { f } from "./f";
        const x: B | C | D = a;
        const g = () => import("./g");
      `),
    ).toEqual(["./a", "./e", "./f"]);
  });

  test("engine code loads nothing over the network", () => {
    expect(io).toEqual([]);
  });

  test("the network check catches calls and references alike", () => {
    const hits = (src: string) => [...src.matchAll(NETWORK)].length > 0;
    for (const src of [
      "fetch(url)",
      "fetch (url)",
      "fetch?.(url)",
      "globalThis.fetch(url)",
      "const request = fetch; request(url)",
      "new XMLHttpRequest()",
      "new WebSocket(url)",
    ]) {
      expect(hits(src), src).toBe(true);
    }
    for (const src of ["prefetch(url)", "refetchAll()", "fetched += 1"]) {
      expect(hits(src), src).toBe(false);
    }
  });
});
