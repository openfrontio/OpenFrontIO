/**
 * Checks that the move commit of #1701 only moves files and rewrites import
 * specifiers: every changed TypeScript file must be identical to its old
 * version once import/export-from declarations are removed. Files outside
 * that rule must be listed in EXPECTED.
 *
 * Usage: npx tsx scripts/split-packages/check-move.ts [<base> [<head>]]
 *   Defaults: base HEAD~1, head HEAD. Pass --cached as head for the index.
 */
import { execFileSync } from "child_process";
import ts from "typescript";
import { moduleRefs, parse, ROOT } from "./lib";

// Config edits the move forces (docs/EnginePackageSplit.md, "Tooling changes
// the move forces"), plus the move's own inputs.
const EXPECTED = [
  /^package(-lock)?\.json$/,
  /^\.npmrc$/,
  /^tsconfig(\.base)?\.json$/,
  /^packages\/[^/]+\/(package|tsconfig)\.json$/,
  /^Dockerfile$/,
  /^eslint\.config\.js$/,
  /^\.gitattributes$/,
  /^\.github\/workflows\/claude-code-review\.yml$/,
  /^map-generator\/(codegen\.go|README\.md)$/,
  /^scripts\/buildAssetHashes\.ts$/,
  /^scripts\/split-packages\//,
  /^tests\/(BuildAssetHashes|CloseCodes|LayerBoundaries|RenderDesktopDescriptor|TranslationSystem)\.test\.ts$/,
  /^packages\/shared\/src\/AssetUrls\.ts$/,
];

const args = process.argv.slice(2);
const base = args[0] ?? "HEAD~1";
const head = args[1] ?? "HEAD";
const git = (...a: string[]) =>
  execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const show = (rev: string, file: string) =>
  git("show", rev === "--cached" ? `:${file}` : `${rev}:${file}`);

/**
 * The file's text with every import/export-from declaration removed and every
 * other module specifier (dynamic import, vi.mock, import types) blanked.
 * Whitespace and trailing commas are dropped, since import blocks and calls
 * reflow when a specifier changes length.
 */
function withoutImports(file: string, text: string): string {
  const sf = parse(file, text);
  const cuts: [number, number, string][] = [];
  for (const s of sf.statements) {
    if (
      ts.isImportDeclaration(s) ||
      (ts.isExportDeclaration(s) && s.moduleSpecifier !== undefined)
    ) {
      cuts.push([s.getStart(sf), s.getEnd(), ""]);
    }
  }
  for (const ref of moduleRefs(sf)) {
    if (ref.kind === "import" || ref.kind === "export") continue;
    cuts.push([ref.start, ref.end, '""']);
  }
  let out = text;
  for (const [start, end, repl] of cuts.sort((x, y) => y[0] - x[0])) {
    out = out.slice(0, start) + repl + out.slice(end);
  }
  return out.replace(/\s+/g, "").replace(/,([)\]}>])/g, "$1");
}

const diffArgs =
  head === "--cached"
    ? ["diff", "--cached", "-M", "--name-status", base]
    : ["diff", "-M", "--name-status", base, head];
const problems: string[] = [];
let renames = 0;
let rewrites = 0;
let expected = 0;
for (const line of git(...diffArgs)
  .trim()
  .split("\n")) {
  const [status, a, b] = line.split("\t");
  const to = b ?? a;
  if (EXPECTED.some((re) => re.test(to))) {
    expected++;
    continue;
  }
  if (status.startsWith("R") || status === "M") {
    if (status === "R100") {
      renames++;
      continue;
    }
    if (!/\.(ts|mts|js|mjs)$/.test(to)) {
      problems.push(`${line}: non-code file changed`);
      continue;
    }
    const before = withoutImports(a, show(base, a));
    const after = withoutImports(to, show(head, to));
    if (before !== after) problems.push(`${line}: changes beyond imports`);
    else rewrites++;
    continue;
  }
  if (status === "D" && a.startsWith("zbin/")) continue; // moved by git mv
  problems.push(`${line}: unexpected ${status}`);
}

console.log(
  `${renames} pure renames, ${rewrites} import-only rewrites, ` +
    `${expected} expected config edits`,
);
if (problems.length > 0) {
  console.log(`\n${problems.length} problems:`);
  for (const p of problems) console.log(`  ${p}`);
  process.exitCode = 1;
}
