/**
 * Enforces the import graph between the engine, its public API, the code
 * shared by client and server, and the apps (#1701, docs/EnginePackageSplit.md).
 *
 * Every src/core file is assigned to the package it will live in. An import
 * edge outside the allowed graph fails unless ALLOWLIST lists it; a listed
 * edge that no longer occurs fails too, so the list only shrinks.
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
  | "shared"
  | "zbin"
  | "client"
  | "server"
  | "resources";

// src/core files that do not end up in the engine.
const FUTURE: Record<string, Pkg> = {
  "src/core/DetMath.ts": "engine-api",
  "src/core/EventBus.ts": "engine-api",
  "src/core/Format.ts": "engine-api",
  "src/core/PatternDecoder.ts": "engine-api",
  "src/core/PseudoRandom.ts": "engine-api",
  "src/core/Schemas.ts": "engine-api",
  "src/core/StatsSchemas.ts": "engine-api",
  "src/core/Util.ts": "engine-api",
  "src/core/configuration/Config.ts": "engine-api",
  "src/core/execution/Util.ts": "engine-api",
  "src/core/game/DoomsdayClock.ts": "engine-api",
  "src/core/game/FetchGameMapLoader.ts": "engine-api",
  "src/core/game/GameMap.ts": "engine-api",
  "src/core/game/GameMapLoader.ts": "engine-api",
  "src/core/game/GameUpdateUtils.ts": "engine-api",
  "src/core/game/GameUpdates.ts": "engine-api",
  "src/core/game/Maps.gen.ts": "engine-api",
  "src/core/game/ReadViews.ts": "engine-api",
  "src/core/game/MotionPlans.ts": "engine-api",
  "src/core/game/Stats.ts": "engine-api",
  "src/core/game/TeamAssignment.ts": "engine-api",
  "src/core/game/TerraNulliusImpl.ts": "engine-api",
  "src/core/game/TerrainMapLoader.ts": "engine-api",
  "src/core/game/TileSet.ts": "engine-api",
  "src/core/game/UnitGrid.ts": "engine-api",
  "src/core/game/Veterancy.ts": "engine-api",
  "src/core/pathfinding/types.ts": "engine-api",
  "src/core/snapshot/SnapshotType.ts": "engine-api",
  "src/core/worker/WorkerMessages.ts": "engine-api",

  "src/core/AnonNames.ts": "shared",
  "src/core/ApiSchemas.ts": "shared",
  "src/core/AssetUrls.ts": "shared",
  "src/core/Base64.ts": "shared",
  "src/core/ClanApiSchemas.ts": "shared",
  "src/core/CloseCodes.ts": "shared",
  "src/core/ClusterConfig.ts": "shared",
  "src/core/CosmeticSchemas.ts": "shared",
  "src/core/ServerList.ts": "shared",
  "src/core/WorkerSchemas.ts": "shared",
  "src/core/ZbinWire.ts": "shared",
};

// The only engine file the apps may load: the simulation worker.
const ENGINE_ENTRY = "src/core/worker/Worker.worker.ts";

const ALLOWED: Record<Pkg, Pkg[]> = {
  "engine-api": ["engine-api", "zbin", "resources"],
  engine: ["engine", "engine-api", "zbin", "resources"],
  shared: ["shared", "engine-api", "zbin", "resources"],
  zbin: ["zbin"],
  client: ["client", "shared", "engine-api", "zbin", "resources"],
  server: ["server", "shared", "engine-api", "zbin", "resources"],
  resources: [],
};

// npm dependencies the deterministic packages may use.
const ENGINE_NPM = new Set(["zod", "zod/v4", "jose"]);

/**
 * Known violations, as "<from> -> <to>" where <from> is a file or a package
 * and <to> is a file. Shrinks to the replay-processor exception by the end of
 * the split; never add to it.
 */
const ALLOWLIST: string[] = [
  "client -> src/core/GameRunner.ts",
  "client -> src/core/game/Game.ts",
  "server -> src/core/game/Game.ts",
  "src/core/ApiSchemas.ts -> src/core/game/Game.ts",
  "src/core/Schemas.ts -> src/core/CosmeticSchemas.ts",
  "src/core/Schemas.ts -> src/core/game/Game.ts",
  "src/core/StatsSchemas.ts -> src/core/game/Game.ts",
  "src/core/Util.ts -> npm:dompurify",
  "src/core/Util.ts -> npm:nanoid",
  "src/core/Util.ts -> src/core/execution/utils/TribeNames.ts",
  "src/core/Util.ts -> src/core/game/Game.ts",
  "src/core/configuration/Config.ts -> src/core/AssetUrls.ts",
  "src/core/configuration/Config.ts -> src/core/ClusterConfig.ts",
  "src/core/configuration/Config.ts -> src/core/game/Game.ts",
  "src/core/execution/Util.ts -> src/core/game/Game.ts",
  "src/core/game/BinaryLoaderGameMapLoader.ts -> src/core/AssetUrls.ts",
  "src/core/game/FetchGameMapLoader.ts -> src/core/game/Game.ts",
  "src/core/game/GameMap.ts -> src/core/game/Game.ts",
  "src/core/game/GameMapLoader.ts -> src/core/game/Game.ts",
  "src/core/game/GameUpdateUtils.ts -> src/core/game/Game.ts",
  "src/core/game/GameUpdates.ts -> src/core/game/Game.ts",
  "src/core/game/Stats.ts -> src/core/game/Game.ts",
  "src/core/game/ReadViews.ts -> src/core/game/Game.ts",
  "src/core/game/TeamAssignment.ts -> src/core/game/Game.ts",
  "src/core/game/TerraNulliusImpl.ts -> src/core/game/Game.ts",
  "src/core/game/TerrainMapLoader.ts -> src/core/game/Game.ts",
  "src/core/game/UnitGrid.ts -> src/core/game/Game.ts",
  "src/core/worker/Worker.worker.ts -> src/core/AssetUrls.ts",
  "src/core/worker/WorkerMessages.ts -> src/core/game/Game.ts",
];

function packageOf(file: string): Pkg | null {
  if (file.startsWith("src/core/")) return FUTURE[file] ?? "engine";
  if (file.startsWith("zbin/")) return "zbin";
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
    ...walk("src/core"),
    ...walk("src/client"),
    ...walk("src/server"),
    ...walk("zbin"),
  ];
  for (const file of files) {
    const from = packageOf(file)!;
    for (const spec of specifiers(file)) {
      const r = resolve(file, spec);
      if ("npm" in r) {
        if (
          (from === "engine" || from === "engine-api") &&
          !ENGINE_NPM.has(r.npm)
        ) {
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
      // Engine-side edges are listed per file; app edges per package, since
      // dozens of app files share each engine target.
      const key = from === "client" || from === "server" ? from : file;
      edges.add(`${key} -> ${r.file}`);
    }
    if (from === "engine" || from === "engine-api") {
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
