/**
 * Lists the names files under the given prefixes import from one module, and
 * from how many files. Analysis aid for the symbol moves of #1701.
 *
 * Usage: npx tsx scripts/split-packages/imported-names.ts <module> <prefix>...
 */
import ts from "typescript";
import {
  abs,
  listSourceFiles,
  moduleRefs,
  parse,
  rel,
  resolveSpec,
} from "./lib";
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
