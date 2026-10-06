/**
 * Splits a module's top-level declarations into the closure needed by a set
 * of root names and the rest. Analysis aid for the symbol moves of #1701.
 *
 * Usage: npx tsx scripts/split-packages/decl-closure.ts <file> <root,root,...>
 */
import ts from "typescript";
import { abs, parse } from "./lib";

const [file, rootList] = process.argv.slice(2);
const sf = parse(abs(file));

const declNames = (s: ts.Statement): string[] => {
  if (
    (ts.isFunctionDeclaration(s) ||
      ts.isClassDeclaration(s) ||
      ts.isInterfaceDeclaration(s) ||
      ts.isTypeAliasDeclaration(s) ||
      ts.isEnumDeclaration(s)) &&
    s.name
  ) {
    return [s.name.text];
  }
  if (ts.isVariableStatement(s)) {
    return s.declarationList.declarations.flatMap((d) =>
      ts.isIdentifier(d.name) ? [d.name.text] : [],
    );
  }
  return [];
};

const owner = new Map<string, ts.Statement>();
const order: string[] = [];
for (const s of sf.statements) {
  for (const n of declNames(s)) {
    owner.set(n, s);
    order.push(n);
  }
}

const refs = new Map<string, Set<string>>();
for (const [name, s] of owner) {
  const out = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && owner.has(node.text) && node.text !== name) {
      out.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(s);
  refs.set(name, out);
}

const keep = new Set<string>();
const queue = rootList.split(",");
for (const r of queue) {
  if (!owner.has(r)) throw new Error(`no declaration ${r}`);
}
while (queue.length > 0) {
  const n = queue.pop()!;
  if (keep.has(n)) continue;
  keep.add(n);
  for (const d of refs.get(n) ?? []) queue.push(d);
}
const exported = (n: string) =>
  ts
    .getModifiers(owner.get(n) as ts.HasModifiers)
    ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
console.log(`KEEP (${keep.size}):`);
console.log(order.filter((n) => keep.has(n)).join(","));
console.log(`\nREST (${order.length - keep.size}):`);
console.log(order.filter((n) => !keep.has(n)).join(","));
console.log(`\nREST exported:`);
console.log(order.filter((n) => !keep.has(n) && exported(n)).join(","));
// Rest declarations that reference kept ones need imports in the new file.
