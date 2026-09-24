/**
 * gzip and gunzip using the browser's CompressionStream and
 * DecompressionStream. The worker compresses replay chunks, the viewer
 * inflates them (ReplayReader.load).
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

export function gunzipInBrowser(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream("gzip"));
}
