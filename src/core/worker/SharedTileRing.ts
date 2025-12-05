import { TileRef } from "../game/GameMap";

export interface SharedTileRingBuffers {
  header: SharedArrayBuffer;
  data: SharedArrayBuffer;
  dirty: SharedArrayBuffer;
  drawPhase: SharedArrayBuffer;
}

export interface SharedTileRingViews {
  header: Int32Array;
  buffer: Uint32Array;
  dirtyFlags: Uint8Array;
  drawPhase: Uint32Array;
  capacity: number;
}

// Header indices
export const TILE_RING_HEADER_WRITE_INDEX = 0;
export const TILE_RING_HEADER_READ_INDEX = 1;
export const TILE_RING_HEADER_OVERFLOW = 2;

export function createSharedTileRingBuffers(
  capacity: number,
  numTiles: number,
): SharedTileRingBuffers {
  const header = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT);
  const data = new SharedArrayBuffer(capacity * Uint32Array.BYTES_PER_ELEMENT);
  const dirty = new SharedArrayBuffer(numTiles * Uint8Array.BYTES_PER_ELEMENT);
  const drawPhase = new SharedArrayBuffer(
    numTiles * Uint32Array.BYTES_PER_ELEMENT,
  );
  return { header, data, dirty, drawPhase };
}

export function createSharedTileRingViews(
  buffers: SharedTileRingBuffers,
): SharedTileRingViews {
  const header = new Int32Array(buffers.header);
  const buffer = new Uint32Array(buffers.data);
  const dirtyFlags = new Uint8Array(buffers.dirty);
  const drawPhase = new Uint32Array(buffers.drawPhase);
  return {
    header,
    buffer,
    dirtyFlags,
    drawPhase,
    capacity: buffer.length,
  };
}

export function pushTileUpdate(
  views: SharedTileRingViews,
  value: TileRef,
): void {
  const { header, buffer, capacity } = views;

  const write = Atomics.load(header, TILE_RING_HEADER_WRITE_INDEX);
  const read = Atomics.load(header, TILE_RING_HEADER_READ_INDEX);
  const nextWrite = (write + 1) % capacity;

  // If the buffer is full, advance read (drop oldest) and mark overflow.
  if (nextWrite === read) {
    Atomics.store(header, TILE_RING_HEADER_OVERFLOW, 1);
    const nextRead = (read + 1) % capacity;
    Atomics.store(header, TILE_RING_HEADER_READ_INDEX, nextRead);
  }

  buffer[write] = value;
  Atomics.store(header, TILE_RING_HEADER_WRITE_INDEX, nextWrite);
}

export function drainTileUpdates(
  views: SharedTileRingViews,
  maxItems: number,
  out: TileRef[],
): void {
  const { header, buffer, capacity } = views;

  let read = Atomics.load(header, TILE_RING_HEADER_READ_INDEX);
  const write = Atomics.load(header, TILE_RING_HEADER_WRITE_INDEX);

  let count = 0;

  while (read !== write && count < maxItems) {
    out.push(buffer[read]);
    read = (read + 1) % capacity;
    count++;
  }

  Atomics.store(header, TILE_RING_HEADER_READ_INDEX, read);
}
