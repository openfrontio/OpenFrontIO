/**
 * gzip and gunzip using the browser's CompressionStream and
 * DecompressionStream. The worker compresses replay chunks, the viewer
 * inflates them (ReplayReader.load), and scenario bundles are both
 * (ScenarioBundle).
 */

async function pipe(
  data: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function gzipInBrowser(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new CompressionStream("gzip"));
}

/** Thrown by gunzipInBrowser when the output passes its `max`. */
export class InflateLimitError extends Error {}

/**
 * Inflates gzip. With a `max`, it stops and throws an InflateLimitError once
 * the output passes that many bytes, so a gzip bomb in another player's
 * upload is never inflated in full.
 */
export async function gunzipInBrowser(
  data: Uint8Array,
  max = Infinity,
): Promise<Uint8Array> {
  if (max === Infinity) return pipe(data, new DecompressionStream("gzip"));
  const reader = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        throw new InflateLimitError(`inflates past ${max} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
