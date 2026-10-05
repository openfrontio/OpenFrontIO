/**
 * Module-reference scanning and resolution shared by the split-packages
 * codemod and analysis scripts. Throwaway tooling for #1701.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { fileURLToPath } from "url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// Every place a module specifier can point into src/core or a package.
const SCAN_DIRS = [
  "src",
  "tests",
  "scripts",
  "packages",
  "zbin",
  "proprietary",
  "__mocks__",
];
const SCAN_FILES = ["vite.config.ts"];
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs)$/;

export const rel = (abs: string) => path.relative(ROOT, abs);
export const abs = (relPath: string) => path.join(ROOT, relPath);

export function listSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (SOURCE_EXT.test(ent.name) && !ent.name.endsWith(".d.ts")) {
        out.push(p);
      }
    }
  };
  for (const d of SCAN_DIRS) walk(abs(d));
  for (const f of SCAN_FILES) if (fs.existsSync(abs(f))) out.push(abs(f));
  return out.sort();
}

export type RefKind =
  | "import"
  | "export"
  | "dynamic-import"
  | "import-type"
  | "mock";

export interface ModuleRef {
  kind: RefKind;
  /** The specifier text without quotes. */
  spec: string;
  /** Offsets of the string literal including its quotes. */
  start: number;
  end: number;
  /** The import/export declaration or the import type node, if any. */
  node: ts.Node;
}

const MOCK_CALLS = new Set([
  "mock",
  "doMock",
  "unmock",
  "doUnmock",
  "importActual",
  "importMock",
]);

export function parse(file: string, text?: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text ?? fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

export function moduleRefs(sf: ts.SourceFile): ModuleRef[] {
  const refs: ModuleRef[] = [];
  const add = (kind: RefKind, lit: ts.Node, node: ts.Node) => {
    if (!ts.isStringLiteralLike(lit)) return;
    refs.push({
      kind,
      spec: lit.text,
      start: lit.getStart(sf),
      end: lit.getEnd(),
      node,
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      add("import", node.moduleSpecifier, node);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add("export", node.moduleSpecifier, node);
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      if (ts.isLiteralTypeNode(arg)) add("import-type", arg.literal, node);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        add("dynamic-import", node.arguments[0], node);
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "vi" &&
        MOCK_CALLS.has(callee.name.text)
      ) {
        add("mock", node.arguments[0], node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

const RESOLVE_EXT = [".ts", ".tsx", ".mts", ".js", ".mjs", ".d.ts"];

function probe(base: string): string | null {
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of RESOLVE_EXT) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  // "./Foo.js" written for a Foo.ts source.
  const stripped = base.replace(/\.(js|mjs)$/, "");
  if (stripped !== base) {
    for (const ext of [".ts", ".mts"]) {
      if (fs.existsSync(stripped + ext)) return stripped + ext;
    }
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of RESOLVE_EXT) {
      const idx = path.join(base, "index" + ext);
      if (fs.existsSync(idx)) return idx;
    }
  }
  return null;
}

export function splitQuery(spec: string): [string, string] {
  const q = spec.indexOf("?");
  return q === -1 ? [spec, ""] : [spec.slice(0, q), spec.slice(q)];
}

export function packageDir(name: string): string {
  return abs(`packages/${name}`);
}

/**
 * Resolves a specifier to an absolute repo path, or null for npm packages and
 * anything outside the repo. Mirrors tsconfig `paths` (src/*, resources/*)
 * and the workspace packages' `exports` ("./*" -> "./src/*.ts", plus "." ->
 * "./src/index.ts").
 */
export function resolveSpec(fromFile: string, spec: string): string | null {
  const [bare] = splitQuery(spec);
  if (bare.startsWith(".")) {
    return probe(path.resolve(path.dirname(fromFile), bare));
  }
  if (bare.startsWith("src/") || bare.startsWith("resources/")) {
    return probe(abs(bare));
  }
  const m = /^@openfront\/([^/]+)(?:\/(.*))?$/.exec(bare);
  if (m) {
    const src = path.join(packageDir(m[1]), "src");
    return probe(
      m[2] === undefined ? path.join(src, "index") : path.join(src, m[2]),
    );
  }
  return null;
}

/** Package that owns a path: a workspace package name, or "root". */
export function packageOf(absPath: string): string {
  const r = rel(absPath).split(path.sep);
  return r[0] === "packages" ? r[1] : "root";
}

const EXT_RE = /\.(d\.ts|ts|tsx|mts|js|mjs|json)$/;

/**
 * The specifier `fromFile` should use for `target`, preserving the style of
 * `original` (extension, `src/` alias, query string).
 */
export function specifierFor(
  fromFile: string,
  target: string,
  original: string,
): string {
  const [bareOrig, query] = splitQuery(original);
  const keepExt = EXT_RE.test(bareOrig) && !/\/index$/.test(bareOrig);
  const origIsIndexDir =
    /\/index\.[a-z.]+$/.test(target) && !/index(\.[a-z]+)?$/.test(bareOrig);
  const fromPkg = packageOf(fromFile);
  const toPkg = packageOf(target);
  // resources/ is shared data every package reaches through the tsconfig
  // `paths` alias; keep that form.
  if (bareOrig.startsWith("resources/")) return original;

  let withoutExt = target.replace(EXT_RE, "");
  if (origIsIndexDir) withoutExt = path.dirname(withoutExt);

  if (toPkg !== "root" && toPkg !== fromPkg) {
    const src = path.join(packageDir(toPkg), "src");
    const sub = path.relative(src, target).replace(EXT_RE, "");
    const spec =
      sub === "index" ? `@openfront/${toPkg}` : `@openfront/${toPkg}/${sub}`;
    return spec.split(path.sep).join("/") + query;
  }
  if (toPkg === "root" && fromPkg !== "root") {
    throw new Error(
      `${rel(fromFile)} would import root-app file ${rel(target)}`,
    );
  }
  const ext = keepExt ? (EXT_RE.exec(target)?.[0] ?? "") : "";
  if (
    fromPkg === "root" &&
    bareOrig.startsWith("src/") &&
    rel(target).startsWith("src" + path.sep)
  ) {
    return rel(withoutExt).split(path.sep).join("/") + ext + query;
  }
  let r = path.relative(path.dirname(fromFile), withoutExt);
  if (!r.startsWith(".")) r = "./" + r;
  return r.split(path.sep).join("/") + ext + query;
}
