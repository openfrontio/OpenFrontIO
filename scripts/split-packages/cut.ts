/**
 * Cuts top-level declarations (with their leading comments) out of one file
 * and appends them to another, for the symbol moves of #1701. Imports are
 * left to the author and to run.ts, which rewrites every importer.
 *
 * Usage: npx tsx scripts/split-packages/cut.ts <from> <to> <name,name,...>
 * A re-export is named "export:<specifier>".
 */
import fs from "fs";
import ts from "typescript";
const [from, to, list] = process.argv.slice(2);
const names = new Set(list.split(","));
const text = fs.readFileSync(from, "utf8");
const sf = ts.createSourceFile(from, text, ts.ScriptTarget.Latest, true);
const declName = (s: ts.Statement): string | null => {
  if (
    (ts.isFunctionDeclaration(s) ||
      ts.isClassDeclaration(s) ||
      ts.isInterfaceDeclaration(s) ||
      ts.isTypeAliasDeclaration(s) ||
      ts.isEnumDeclaration(s)) &&
    s.name
  )
    return s.name.text;
  if (
    ts.isVariableStatement(s) &&
    s.declarationList.declarations.length === 1
  ) {
    const n = s.declarationList.declarations[0].name;
    return ts.isIdentifier(n) ? n.text : null;
  }
  if (ts.isExportDeclaration(s))
    return "export:" + (s.moduleSpecifier as ts.StringLiteral)?.text;
  return null;
};
const cut: [number, number][] = [];
const moved: string[] = [];
const found = new Set<string>();
for (const s of sf.statements) {
  const n = declName(s);
  if (n !== null && names.has(n)) {
    // Leading trivia, minus blank lines before the first comment.
    let start = s.getFullStart();
    while (text[start] === "\n") start++;
    cut.push([start, s.getEnd()]);
    moved.push(text.slice(start, s.getEnd()));
    found.add(n);
  }
}
const missing = [...names].filter((n) => !found.has(n));
if (missing.length) throw new Error("missing: " + missing.join(","));
let out = text;
for (const [s, e] of cut.reverse()) {
  let end = e;
  while (out[end] === "\n" && out[end + 1] === "\n") end++;
  out = out.slice(0, s) + out.slice(end);
}
fs.writeFileSync(from, out);
const prev = fs.existsSync(to)
  ? fs.readFileSync(to, "utf8").trimEnd() + "\n\n"
  : "";
fs.writeFileSync(to, prev + moved.join("\n\n") + "\n");
console.log(`moved ${moved.length} declarations`);
