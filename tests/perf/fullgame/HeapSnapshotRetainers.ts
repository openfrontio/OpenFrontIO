/**
 * Retainer attribution for a V8 .heapsnapshot: aggregates every node's self
 * size under a label derived from its retainer chain — the nearest ancestor
 * with a project-meaningful constructor name plus the property path from it
 * (e.g. "PlayerImpl._tiles.table"). Also lists the largest individual nodes
 * with their full retainer chains.
 *
 * Loads the whole snapshot with JSON.parse, so only suitable for snapshots
 * under V8's max string length (~500 MB); use HeapSnapshotSummary.ts for a
 * flat by-type summary of bigger files.
 *
 * Usage:
 *   npx tsx tests/perf/fullgame/HeapSnapshotRetainers.ts <file.heapsnapshot> [top]
 */
import fs from "fs";

// Constructor names that identify a container, not an owner — the walk
// continues past these to find whose field the container is.
const GENERIC_NAMES = new Set([
  "",
  "Object",
  "Array",
  "Set",
  "Map",
  "WeakMap",
  "WeakSet",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

function main(): void {
  const file = process.argv[2];
  const top = parseInt(process.argv[3] ?? "40", 10);
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as {
    snapshot: {
      meta: {
        node_fields: string[];
        node_types: (string[] | string)[];
        edge_fields: string[];
        edge_types: (string[] | string)[];
      };
      node_count: number;
      edge_count: number;
    };
    nodes: number[];
    edges: number[];
    strings: string[];
  };

  const { meta } = snap.snapshot;
  const NF = meta.node_fields.length;
  const N_TYPE = meta.node_fields.indexOf("type");
  const N_NAME = meta.node_fields.indexOf("name");
  const N_SIZE = meta.node_fields.indexOf("self_size");
  const N_EDGES = meta.node_fields.indexOf("edge_count");
  const nodeTypes = meta.node_types[N_TYPE] as string[];
  const EF = meta.edge_fields.length;
  const E_TYPE = meta.edge_fields.indexOf("type");
  const E_NAME = meta.edge_fields.indexOf("name_or_index");
  const E_TO = meta.edge_fields.indexOf("to_node");
  const edgeTypes = meta.edge_types[E_TYPE] as string[];
  const WEAK_EDGE = edgeTypes.indexOf("weak");
  const ELEMENT_EDGE = edgeTypes.indexOf("element");
  const HIDDEN_EDGE = edgeTypes.indexOf("hidden");

  const { nodes, edges, strings } = snap;
  const nodeCount = snap.snapshot.node_count;

  // First retainer of each node (prefer non-weak edges), plus the edge name.
  const retainer = new Int32Array(nodeCount).fill(-1);
  const retainerWeak = new Uint8Array(nodeCount);
  const retainerEdge = new Int32Array(nodeCount).fill(-1); // string idx or -1
  let edgeIdx = 0;
  for (let src = 0; src < nodeCount; src++) {
    const count = nodes[src * NF + N_EDGES];
    for (let e = 0; e < count; e++, edgeIdx += EF) {
      const to = edges[edgeIdx + E_TO] / NF;
      const type = edges[edgeIdx + E_TYPE];
      const weak = type === WEAK_EDGE ? 1 : 0;
      if (retainer[to] === -1 || (retainerWeak[to] === 1 && weak === 0)) {
        retainer[to] = src;
        retainerWeak[to] = weak;
        retainerEdge[to] =
          type === ELEMENT_EDGE || type === HIDDEN_EDGE
            ? -2 // numeric index — label as []
            : edges[edgeIdx + E_NAME];
      }
    }
  }

  // Cap at one short line: string-type node names are the full string
  // content (e.g. an entire script source for external strings).
  const nodeName = (i: number): string => {
    const raw = strings[nodes[i * NF + N_NAME]] ?? "";
    const firstLine = raw.split("\n", 1)[0];
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
  };
  const nodeType = (i: number): string => nodeTypes[nodes[i * NF + N_TYPE]];
  const edgeLabel = (i: number): string =>
    retainerEdge[i] === -2 ? "[]" : (strings[retainerEdge[i]] ?? "?");

  // Label a node by its nearest non-generic named ancestor plus the property
  // path from that ancestor (capped, deepest segments dropped first).
  const labelOf = (i: number): string => {
    const segments: string[] = [];
    let cur = i;
    for (let depth = 0; depth < 12; depth++) {
      const parent = retainer[cur];
      if (parent === -1) return `(root) ${segments.join(".")}`;
      const t = nodeType(parent);
      const name = nodeName(parent);
      if (
        (t === "object" || t === "closure" || t === "native") &&
        !GENERIC_NAMES.has(name)
      ) {
        return `${name}.${segments.slice(0, 3).join(".")}`;
      }
      if (t === "synthetic") {
        return `(${name}) ${segments.slice(0, 3).join(".")}`;
      }
      segments.unshift(edgeLabel(cur));
      cur = parent;
    }
    return `(deep) ${segments.slice(0, 3).join(".")}`;
  };

  interface Bucket {
    bytes: number;
    count: number;
  }
  const buckets = new Map<string, Bucket>();
  let totalBytes = 0;
  const big: { i: number; size: number }[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const size = nodes[i * NF + N_SIZE];
    if (size === 0) continue;
    totalBytes += size;
    const t = nodeType(i);
    // Group bulk data types under their retainers; everything else by type.
    const key =
      t === "code" || t === "string" || t === "concatenated string"
        ? `(all ${t})`
        : labelOf(i);
    const b = buckets.get(key);
    if (b) {
      b.bytes += size;
      b.count++;
    } else {
      buckets.set(key, { bytes: size, count: 1 });
    }
    if (size >= 128 * 1024) {
      big.push({ i, size });
    }
  }

  const fmtMB = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2);

  console.log(`${file}\nlive: ${fmtMB(totalBytes)} MB\n`);
  console.log(`--- Top ${top} retainer groups by self size ---`);
  const sorted = [...buckets.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  for (const [label, b] of sorted.slice(0, top)) {
    console.log(
      `${fmtMB(b.bytes).padStart(9)} MB  ${String(b.count).padStart(8)}  ${label}`,
    );
  }

  console.log(`\n--- Nodes ≥128KB with retainer chains ---`);
  big.sort((a, b) => b.size - a.size);
  for (const { i, size } of big.slice(0, top)) {
    const chain: string[] = [];
    let cur = i;
    for (let depth = 0; depth < 8 && retainer[cur] !== -1; depth++) {
      const parent = retainer[cur];
      chain.push(`${nodeName(parent) || nodeType(parent)}.${edgeLabel(cur)}`);
      cur = parent;
    }
    console.log(
      `${fmtMB(size).padStart(9)} MB  ${nodeType(i)} ${nodeName(i)}  ←  ${chain.join("  ←  ")}`,
    );
  }
}

main();
