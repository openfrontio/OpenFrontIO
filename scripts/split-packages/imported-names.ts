/**
 * Lists the names files under the given prefixes import from one module, and
 * from how many files. Analysis aid for the symbol moves of #1701.
 *
 * Usage: npx tsx scripts/split-packages/imported-names.ts <module> <prefix>...
 */
// DISABLED: TypeScript 7.0 ships no JavaScript compiler API - the package
// only exports a version string - so this script cannot parse TypeScript any
// more. The replacement API (typescript/sync, typescript/ast) arrives with
// TypeScript 7.1: it is in beta today (`npm i -D typescript@7.1.0-beta`) and
// the final release is expected in December 2026. Until then this script is
// kept as it is, but is not type-checked and refuses to run. The next split
// has to wait for that release.
// See https://github.com/openfrontio/OpenFrontIO/issues/4982
// @ts-nocheck
import ts from "typescript";
import {
  abs,
  assertCompilerApiAvailable,
  listSourceFiles,
  moduleRefs,
  parse,
  rel,
  resolveSpec,
} from "./lib";

assertCompilerApiAvailable();
const target = abs(process.argv[2]);
const prefixes = process.argv.slice(3);
const names = new Map<string, Set<string>>();
for (const f of listSourceFiles()) {
  const r = rel(f);
  if (!prefixes.some((p) => r.startsWith(p))) continue;
  const sf = parse(f);
  for (const ref of moduleRefs(sf)) {
    if (resolveSpec(f, ref.spec) !== target) continue;
    const n = ref.node;
    if (
      ts.isImportDeclaration(n) &&
      n.importClause?.namedBindings &&
      ts.isNamedImports(n.importClause.namedBindings)
    ) {
      for (const e of n.importClause.namedBindings.elements) {
        const nm = (e.propertyName ?? e.name).text;
        if (!names.has(nm)) names.set(nm, new Set());
        names.get(nm)!.add(r);
      }
    } else if (ts.isImportTypeNode(n)) {
      const q =
        n.qualifier && ts.isIdentifier(n.qualifier) ? n.qualifier.text : "?";
      if (!names.has(q)) names.set(q, new Set());
      names.get(q)!.add(r + " (import type)");
    } else console.log("other ref", r, ref.kind);
  }
}
for (const [n, fs] of [...names].sort())
  console.log(n.padEnd(28), fs.size, [...fs].slice(0, 3).join(" "));
