/**
 * Summarizes a V8 .heapsnapshot file: total live bytes and the top heap
 * consumers grouped by (node type, constructor/name), by self size.
 *
 * Snapshot files from a large heap are multi-GB JSON — far beyond V8's max
 * string length — so this streams the file and parses just the `nodes` array
 * (flat integers) and the `strings` table with a byte-level scanner.
 *
 * Usage:
 *   npx tsx tests/perf/fullgame/HeapSnapshotSummary.ts <file.heapsnapshot> [top]
 */
import fs from "fs";

interface Group {
  typeIdx: number;
  nameIdx: number; // -1 when the type's node names are per-instance content
  count: number;
  bytes: number;
}

// Node types whose per-node name is instance content (string payloads,
// function source positions, ...) rather than a meaningful grouping key.
const CONTENT_NAMED_TYPES = new Set([
  "string",
  "concatenated string",
  "sliced string",
  "number",
  "bigint",
  "symbol",
  "regexp",
  "code",
]);

async function main(): Promise<void> {
  const file = process.argv[2];
  const top = parseInt(process.argv[3] ?? "40", 10);
  if (!file) {
    console.error(
      "usage: npx tsx tests/perf/fullgame/HeapSnapshotSummary.ts <file.heapsnapshot> [top]",
    );
    process.exit(1);
  }

  // ── Meta: parse the small "snapshot" header object from the file prefix ──
  const fd = fs.openSync(file, "r");
  const prefixBuf = Buffer.alloc(1 << 20);
  const prefixLen = fs.readSync(fd, prefixBuf, 0, prefixBuf.length, 0);
  fs.closeSync(fd);
  const prefix = prefixBuf.subarray(0, prefixLen).toString("utf8");
  const nodesKey = '"nodes":[';
  const nodesIdx = prefix.indexOf(nodesKey);
  if (nodesIdx < 0) {
    throw new Error(`"nodes" array not found in the first 1MB of ${file}`);
  }
  const metaJson = prefix.slice(0, prefix.lastIndexOf(",", nodesIdx)) + "}";
  const meta = JSON.parse(metaJson).snapshot.meta as {
    node_fields: string[];
    node_types: (string[] | string)[];
  };
  const fieldCount = meta.node_fields.length;
  const typeField = meta.node_fields.indexOf("type");
  const nameField = meta.node_fields.indexOf("name");
  const sizeField = meta.node_fields.indexOf("self_size");
  const typeNames = meta.node_types[typeField] as string[];
  const contentNamedTypeIdx = new Set(
    typeNames.flatMap((t, i) => (CONTENT_NAMED_TYPES.has(t) ? [i] : [])),
  );

  // ── Stream pass: aggregate the nodes array, then collect needed strings ──
  const groups = new Map<number, Group>();
  const groupKey = (typeIdx: number, nameIdx: number) =>
    typeIdx * 0x100000000 + nameIdx + 1; // +1 so nameIdx -1 maps to 0

  let totalBytes = 0;
  let totalNodes = 0;

  // Scanner state.
  const SEEK_STRINGS = 0; // between the nodes array and the strings table
  const IN_NODES = 1;
  const STRINGS_BETWEEN = 2; // inside strings array, between tokens
  const IN_STRING = 3;
  const DONE = 4;
  let state = IN_NODES;

  // IN_NODES state: integer accumulator + current node's fields.
  let cur = 0;
  let hasCur = false;
  const nodeVals = new Array<number>(fieldCount).fill(0);
  let fieldIdx = 0;

  const finishNumber = (): void => {
    if (!hasCur) return;
    nodeVals[fieldIdx] = cur;
    cur = 0;
    hasCur = false;
    if (++fieldIdx === fieldCount) {
      fieldIdx = 0;
      totalNodes++;
      const size = nodeVals[sizeField];
      totalBytes += size;
      const typeIdx = nodeVals[typeField];
      const nameIdx = contentNamedTypeIdx.has(typeIdx)
        ? -1
        : nodeVals[nameField];
      const key = groupKey(typeIdx, nameIdx);
      const g = groups.get(key);
      if (g) {
        g.count++;
        g.bytes += size;
      } else {
        groups.set(key, { typeIdx, nameIdx, count: 1, bytes: size });
      }
    }
  };

  // SEEK_STRINGS state: match the `"strings":[` marker across chunk borders.
  const stringsKey = Buffer.from('"strings":[');
  let matchPos = 0;

  // IN_STRING state: raw token bytes (with quotes) for JSON.parse.
  let stringIdx = 0;
  let escape = false;
  let tokenChunks: Buffer[] = [];
  let tokenStart = -1; // start of current token in current chunk, if wanted
  let wantToken = false;
  const names = new Map<number, string>();
  const neededNames = new Set<number>();

  const stream = fs.createReadStream(file, {
    start: nodesIdx + nodesKey.length,
    highWaterMark: 8 << 20,
  });

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      switch (state) {
        case IN_NODES:
          if (b >= 0x30 && b <= 0x39) {
            cur = cur * 10 + (b - 0x30);
            hasCur = true;
          } else {
            finishNumber();
            if (b === 0x5d) {
              // "]" — end of nodes; now that groups are final, we know which
              // string-table entries we need.
              for (const g of groups.values()) {
                if (g.nameIdx >= 0) neededNames.add(g.nameIdx);
              }
              state = SEEK_STRINGS;
            }
          }
          break;
        case SEEK_STRINGS:
          if (b === stringsKey[matchPos]) {
            if (++matchPos === stringsKey.length) {
              state = STRINGS_BETWEEN;
            }
          } else {
            matchPos = b === stringsKey[0] ? 1 : 0;
          }
          break;
        case STRINGS_BETWEEN:
          if (b === 0x22) {
            state = IN_STRING;
            escape = false;
            wantToken = neededNames.has(stringIdx);
            tokenChunks = [];
            tokenStart = wantToken ? i : -1;
          } else if (b === 0x5d) {
            state = DONE;
          }
          break;
        case IN_STRING:
          if (escape) {
            escape = false;
          } else if (b === 0x5c) {
            escape = true;
          } else if (b === 0x22) {
            if (wantToken) {
              tokenChunks.push(chunk.subarray(tokenStart, i + 1));
              names.set(
                stringIdx,
                JSON.parse(Buffer.concat(tokenChunks).toString("utf8")),
              );
              tokenChunks = [];
            }
            stringIdx++;
            state = STRINGS_BETWEEN;
          }
          break;
        case DONE:
          break;
      }
    }
    // Carry an in-progress wanted token across the chunk border.
    if (state === IN_STRING && wantToken) {
      tokenChunks.push(chunk.subarray(Math.max(tokenStart, 0)));
      tokenStart = 0;
    }
    if (state === DONE) break;
  }

  // ── Report ──
  const fmtMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2);
  const all = [...groups.values()].sort((a, b) => b.bytes - a.bytes);

  console.log(
    `${file}\nlive: ${fmtMB(totalBytes)} MB across ${totalNodes} nodes\n`,
  );

  const byType = new Map<number, { count: number; bytes: number }>();
  for (const g of all) {
    const t = byType.get(g.typeIdx) ?? { count: 0, bytes: 0 };
    t.count += g.count;
    t.bytes += g.bytes;
    byType.set(g.typeIdx, t);
  }
  console.log("--- By node type ---");
  for (const [typeIdx, t] of [...byType.entries()].sort(
    (a, b) => b[1].bytes - a[1].bytes,
  )) {
    console.log(
      `${fmtMB(t.bytes).padStart(10)} MB  ${String(t.count).padStart(9)}  ${typeNames[typeIdx]}`,
    );
  }

  console.log(`\n--- Top ${top} by (type, name) self size ---`);
  console.log(
    `${"MB".padStart(10)}  ${"%".padStart(5)}  ${"count".padStart(9)}  group`,
  );
  for (const g of all.slice(0, top)) {
    const name =
      g.nameIdx < 0
        ? `(${typeNames[g.typeIdx]} data)`
        : (names.get(g.nameIdx) ?? `<string #${g.nameIdx}>`);
    console.log(
      `${fmtMB(g.bytes).padStart(10)}  ${((g.bytes * 100) / totalBytes)
        .toFixed(1)
        .padStart(
          5,
        )}  ${String(g.count).padStart(9)}  ${typeNames[g.typeIdx]} ${name}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
