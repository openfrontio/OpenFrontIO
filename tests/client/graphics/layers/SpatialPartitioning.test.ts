import { describe, expect, test } from "vitest";

/**
 * Utility functions for chunk-based spatial partitioning.
 *
 * In the tiled rendering system, the world is divided into fixed-size chunks
 * (typically 1024x1024) to keep GPU textures within hardware limits.
 */

/**
 * Calculates the total number of chunks required for a given map dimension.
 */
export function calculateChunksCount(
  mapSize: number,
  chunkSize: number,
): number {
  return Math.ceil(mapSize / chunkSize);
}

/**
 * Maps a world coordinate to its corresponding chunk index.
 */
export function getChunkIndex(
  x: number,
  y: number,
  chunkSize: number,
  chunksX: number,
): number {
  const cx = Math.floor(x / chunkSize);
  const cy = Math.floor(y / chunkSize);
  return cy * chunksX + cx;
}

/**
 * Calculates the width or height of a chunk, accounting for edge cases where
 * the map size is not a multiple of the chunk size.
 */
export function getChunkDimension(
  chunkCoord: number,
  mapSize: number,
  chunkSize: number,
): number {
  const startPos = chunkCoord * chunkSize;
  return Math.min(chunkSize, mapSize - startPos);
}

describe("Spatial Partitioning (Chunking) Logic", () => {
  const CHUNK_SIZE = 1024;

  describe("calculateChunksCount", () => {
    test("calculates correct count for exact multiples", () => {
      expect(calculateChunksCount(2048, CHUNK_SIZE)).toBe(2);
      expect(calculateChunksCount(1024, CHUNK_SIZE)).toBe(1);
    });

    test("calculates correct count for non-multiples (rounds up)", () => {
      expect(calculateChunksCount(2049, CHUNK_SIZE)).toBe(3);
      expect(calculateChunksCount(500, CHUNK_SIZE)).toBe(1);
    });
  });

  describe("getChunkIndex", () => {
    const chunksX = 5; // e.g. 5000px map

    test("maps origin to first chunk", () => {
      expect(getChunkIndex(0, 0, CHUNK_SIZE, chunksX)).toBe(0);
    });

    test("maps coordinates within first chunk correctly", () => {
      expect(getChunkIndex(500, 500, CHUNK_SIZE, chunksX)).toBe(0);
      expect(getChunkIndex(1023, 1023, CHUNK_SIZE, chunksX)).toBe(0);
    });

    test("maps coordinates across chunk boundaries", () => {
      // (1, 0) chunk
      expect(getChunkIndex(1024, 0, CHUNK_SIZE, chunksX)).toBe(1);
      // (0, 1) chunk -> index = 1 * 5 + 0 = 5
      expect(getChunkIndex(0, 1024, CHUNK_SIZE, chunksX)).toBe(5);
      // (2, 3) chunk -> index = 3 * 5 + 2 = 17
      expect(getChunkIndex(2500, 3500, CHUNK_SIZE, chunksX)).toBe(17);
    });
  });

  describe("getChunkDimension", () => {
    const MAP_SIZE = 2500;

    test("returns full size for middle chunks", () => {
      expect(getChunkDimension(0, MAP_SIZE, CHUNK_SIZE)).toBe(1024);
      expect(getChunkDimension(1, MAP_SIZE, CHUNK_SIZE)).toBe(1024);
    });

    test("returns remaining size for edge chunks", () => {
      // 2500 - (2 * 1024) = 452
      expect(getChunkDimension(2, MAP_SIZE, CHUNK_SIZE)).toBe(452);
    });
  });
});
