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

// The only engine file the apps may load: the simulation worker.
const ENGINE_ENTRY = "packages/engine/src/worker/Worker.worker.ts";

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
 * Known violations, as "<from file> -> <to file>"; never add to it.
 *
 * The replay processor runs createGameRunner in its own worker. It moves
 * behind an engine worker entry with the Node engine host (#1701 follow-up).
 */
const ALLOWLIST: string[] = [
  "src/client/replay/processor/ReplayProcessor.ts -> packages/engine/src/GameRunner.ts",
  "src/client/replay/processor/ReplayProcessor.ts -> packages/engine/src/game/Game.ts",
];

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

function violations(): { edges: Set<string>; determinism: string[] } {
  const edges = new Set<string>();
  const determinism: string[] = [];
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
      edges.add(`${file} -> ${r.file}`);
    }
    if (ENGINE_SIDE.has(from)) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const m of text.matchAll(/Math\.random|Date\.now|new Date\b/g)) {
        const line = text.slice(0, m.index).split("\n").length;
        const src = text.split("\n")[line - 1].trim();
        if (src.startsWith("//") || src.startsWith("*")) continue;
        determinism.push(`${file}:${line}: ${m[0]}`);
      }
    }
  }
  return { edges, determinism };
}

describe("layer boundaries", () => {
  const { edges, determinism } = violations();

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
});
