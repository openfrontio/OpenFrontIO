/**
 * Codemod for the src/core package split (#1701). Rewrites module specifiers
 * and runs `git mv`; it never edits declarations.
 *
 * Usage: npx tsx scripts/split-packages/run.ts <moves.json> [--dry-run]
 *
 * moves.json:
 *   {
 *     "files": { "src/core/a.ts": "packages/engine/src/a.ts" },
 *     "symbols": [{ "from": "src/core/X.ts", "to": "src/core/Y.ts",
 *                   "names": ["A", "B"] }]
 *   }
 *
 * File moves rewrite every specifier that points at a moved file (or sits in
 * one): relative inside a package, `@openfront/<pkg>/<path>` across packages.
 * Symbol moves split import/export declarations by name so each name comes
 * from the file that now declares it; the declarations themselves are moved
 * by hand beforehand. Anything it can't rewrite safely (namespace imports or
 * `export *` of a split file, a package importing the root app) is flagged
 * and the run exits non-zero. Running it twice is a no-op.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  abs,
  listSourceFiles,
  moduleRefs,
  parse,
  rel,
  resolveSpec,
  ROOT,
  specifierFor,
} from "./lib";

interface SymbolMove {
  from: string;
  to: string;
  names: string[];
}
interface Moves {
  files?: Record<string, string>;
  symbols?: SymbolMove[];
}
interface Edit {
  start: number;
  end: number;
  text: string;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const movesPath = args.find((a) => !a.startsWith("--"));
if (movesPath === undefined) {
  console.error("usage: run.ts <moves.json> [--dry-run]");
  process.exit(2);
}
const moves: Moves = JSON.parse(fs.readFileSync(movesPath, "utf8"));

// Absolute old path -> absolute new path, skipping moves already done.
const fileMoves = new Map<string, string>();
for (const [from, to] of Object.entries(moves.files ?? {})) {
  if (fs.existsSync(abs(from))) fileMoves.set(abs(from), abs(to));
  else if (!fs.existsSync(abs(to))) {
    throw new Error(`neither ${from} nor ${to} exists`);
  }
}
const symbolMoves = (moves.symbols ?? []).map((m) => ({
  from: abs(m.from),
  to: abs(m.to),
  names: new Set(m.names),
}));

const newPath = (p: string) => fileMoves.get(p) ?? p;
const flagged: string[] = [];
const warnings: string[] = [];
const rewritten = new Map<string, number>();

function quoteOf(sf: ts.SourceFile, start: number): string {
  return sf.text[start];
}

/** Rebuilds a named import/export clause for a subset of its elements. */
function clauseText(
  sf: ts.SourceFile,
  decl: ts.ImportDeclaration | ts.ExportDeclaration,
  elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[],
  spec: string,
  quote: string,
): string {
  const names = elements.map((e) => e.getText(sf)).join(", ");
  if (ts.isImportDeclaration(decl)) {
    const typeOnly = decl.importClause?.isTypeOnly ? "type " : "";
    return `import ${typeOnly}{ ${names} } from ${quote}${spec}${quote};`;
  }
  const typeOnly = decl.isTypeOnly ? "type " : "";
  return `export ${typeOnly}{ ${names} } from ${quote}${spec}${quote};`;
}

function processFile(file: string): Edit[] {
  const sf = parse(file);
  const here = newPath(file);
  const edits: Edit[] = [];
  const where = (n: ts.Node) =>
    `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;

  for (const ref of moduleRefs(sf)) {
    const target = resolveSpec(file, ref.spec);
    if (target === null) continue;
    const quote = quoteOf(sf, ref.start);
    const split = symbolMoves.filter((m) => m.from === target);

    if (split.length > 0) {
      const done = splitRef(sf, file, here, ref, target, split, quote, where);
      if (done !== null) {
        edits.push(...done);
        continue;
      }
    }

    if (!fileMoves.has(file) && !fileMoves.has(target)) continue;
    let spec: string;
    try {
      spec = specifierFor(here, newPath(target), ref.spec);
    } catch (e) {
      flagged.push(`${where(ref.node)}: ${(e as Error).message}`);
      continue;
    }
    if (spec !== ref.spec) {
      edits.push({
        start: ref.start,
        end: ref.end,
        text: quote + spec + quote,
      });
    }
  }
  return edits;
}

/**
 * Splits one reference to a file that is losing symbols. Returns null when
 * nothing referenced moves, so the caller falls through to file-move logic.
 */
function splitRef(
  sf: ts.SourceFile,
  file: string,
  here: string,
  ref: ReturnType<typeof moduleRefs>[number],
  target: string,
  split: typeof symbolMoves,
  quote: string,
  where: (n: ts.Node) => string,
): Edit[] | null {
  const destOf = (name: string) => split.find((m) => m.names.has(name))?.to;
  const node = ref.node;

  if (ref.kind === "import-type") {
    const q = (node as ts.ImportTypeNode).qualifier;
    const first =
      q === undefined ? undefined : ts.isIdentifier(q) ? q : leftmost(q);
    const dest = first === undefined ? undefined : destOf(first.text);
    if (dest === undefined) return null;
    const spec = specifierFor(here, newPath(dest), ref.spec);
    return [{ start: ref.start, end: ref.end, text: quote + spec + quote }];
  }
  if (ref.kind === "mock" || ref.kind === "dynamic-import") {
    warnings.push(
      `${where(node)}: ${ref.kind} of ${rel(target)}, which loses symbols; check by hand`,
    );
    return null;
  }

  const decl = node as ts.ImportDeclaration | ts.ExportDeclaration;
  let elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[];
  if (ts.isImportDeclaration(decl)) {
    const clause = decl.importClause;
    if (clause === undefined) return null; // side-effect import
    const nb = clause.namedBindings;
    if (nb !== undefined && ts.isNamespaceImport(nb)) {
      flagged.push(
        `${where(decl)}: namespace import of split file ${rel(target)}`,
      );
      return null;
    }
    if (nb === undefined) return null;
    if (
      clause.name !== undefined &&
      nb.elements.some((e) => destOf(importedName(e)))
    ) {
      flagged.push(
        `${where(decl)}: default + named import of split file ${rel(target)}`,
      );
      return null;
    }
    elements = nb.elements;
  } else {
    const ec = decl.exportClause;
    if (ec === undefined || !ts.isNamedExports(ec)) {
      flagged.push(`${where(decl)}: export * of split file ${rel(target)}`);
      return null;
    }
    elements = ec.elements;
  }

  const groups = new Map<string, (ts.ImportSpecifier | ts.ExportSpecifier)[]>();
  for (const e of elements) {
    const dest = destOf(importedName(e)) ?? target;
    if (!groups.has(dest)) groups.set(dest, []);
    groups.get(dest)!.push(e);
  }
  if (groups.size === 1 && groups.has(target)) return null;

  const decls: string[] = [];
  for (const [dest, els] of groups) {
    // The destination file declares these names itself now.
    if (newPath(dest) === here) continue;
    const spec =
      dest === target && !fileMoves.has(file) && !fileMoves.has(target)
        ? ref.spec
        : specifierFor(here, newPath(dest), ref.spec);
    decls.push(clauseText(sf, decl, els, spec, quote));
  }
  return [
    {
      start: decl.getStart(sf),
      end: decl.getEnd(),
      text: decls.join("\n"),
    },
  ];
}

function importedName(e: ts.ImportSpecifier | ts.ExportSpecifier): string {
  return (e.propertyName ?? e.name).text;
}

function leftmost(q: ts.QualifiedName): ts.Identifier {
  let n: ts.EntityName = q;
  while (ts.isQualifiedName(n)) n = n.left;
  return n;
}

function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].end > sorted[i - 1].start) {
      throw new Error("overlapping edits");
    }
  }
  for (const e of sorted) {
    text = text.slice(0, e.start) + e.text + text.slice(e.end);
  }
  return text;
}

const changed: string[] = [];
for (const file of listSourceFiles()) {
  const edits = processFile(file);
  if (edits.length === 0) continue;
  const before = fs.readFileSync(file, "utf8");
  const after = applyEdits(before, edits);
  if (after === before) continue;
  rewritten.set(rel(file), edits.length);
  changed.push(file);
  if (!dryRun) fs.writeFileSync(file, after);
}

if (!dryRun && changed.length > 0) {
  // Re-sort and merge the import blocks we touched (prettier-plugin-organize-imports).
  for (let i = 0; i < changed.length; i += 100) {
    execFileSync(
      path.join(ROOT, "node_modules/.bin/prettier"),
      ["--write", "--log-level=warn", ...changed.slice(i, i + 100)],
      { cwd: ROOT, stdio: "inherit" },
    );
  }
}

let moved = 0;
if (!dryRun) {
  for (const [from, to] of fileMoves) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    execFileSync("git", ["mv", from, to], { cwd: ROOT });
    moved++;
  }
}

console.log(
  `${dryRun ? "[dry run] " : ""}files moved: ${dryRun ? fileMoves.size : moved}, ` +
    `files rewritten: ${rewritten.size}, specifiers rewritten: ` +
    `${[...rewritten.values()].reduce((a, b) => a + b, 0)}`,
);
for (const [f, n] of [...rewritten].sort()) console.log(`  ${n}\t${f}`);
if (warnings.length > 0) {
  console.log(`\nwarnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  ${w}`);
}
if (flagged.length > 0) {
  console.log(`\nflagged (${flagged.length}):`);
  for (const f of flagged) console.log(`  ${f}`);
  process.exitCode = 1;
}
