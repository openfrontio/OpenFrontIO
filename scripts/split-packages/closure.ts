/**
 * Prints the src/core files reachable from src/client and src/server (the
 * future engine-api + shared surface), with the edge that pulls each one in.
 * Analysis aid for #1701.
 *
 * Usage: npx tsx scripts/split-packages/closure.ts [--exclude <path>...]
 *   --exclude: core files to treat as engine-only entries (not traversed),
 *              e.g. src/core/worker/Worker.worker.ts
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
import {
  assertCompilerApiAvailable,
  listSourceFiles,
  moduleRefs,
  parse,
  rel,
  resolveSpec,
} from "./lib";

assertCompilerApiAvailable();

const argv = process.argv.slice(2);
const excluded = new Set<string>();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--exclude") excluded.add(argv[++i]);
}

const graph = new Map<string, Set<string>>();
for (const file of listSourceFiles()) {
  const deps = new Set<string>();
  for (const ref of moduleRefs(parse(file))) {
    const t = resolveSpec(file, ref.spec);
    if (t !== null) deps.add(rel(t));
  }
  graph.set(rel(file), deps);
}

const isCore = (f: string) =>
  f.startsWith("src/core/") || f.startsWith("packages/engine");
const via = new Map<string, string>();
const queue: string[] = [];
for (const [f, deps] of graph) {
  if (!f.startsWith("src/client/") && !f.startsWith("src/server/")) continue;
  for (const d of deps) {
    if (isCore(d) && !excluded.has(d) && !via.has(d)) {
      via.set(d, f);
      queue.push(d);
    }
  }
}
while (queue.length > 0) {
  const f = queue.shift()!;
  for (const d of graph.get(f) ?? []) {
    if (isCore(d) && !excluded.has(d) && !via.has(d)) {
      via.set(d, f);
      queue.push(d);
    }
  }
}
const all = [...graph.keys()].filter(isCore);
console.log(`reachable ${via.size} / ${all.length} core files`);
for (const f of [...via.keys()].sort()) console.log(`  ${f}  <- ${via.get(f)}`);
