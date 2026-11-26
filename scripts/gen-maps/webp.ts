// WebP encoding through libwebp 1.6.0 built to wasm (vendor/webp.wasm, the
// lib/webp.wasm of github.com/gen2brain/webp v0.6.4, which the Go generator
// embedded), so the output is byte-identical on every machine.
import { readFileSync } from "node:fs";

let compiled: WebAssembly.Module | null = null;

function module(): WebAssembly.Module {
  compiled ??= new WebAssembly.Module(
    readFileSync(new URL("./vendor/webp.wasm", import.meta.url)),
  );
  return compiled;
}

interface WebPExports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(size: number): number;
  free(ptr: number): void;
  encode(
    inPtr: number,
    width: number,
    height: number,
    sizePtr: number,
    colorspace: number,
    quality: number,
    method: number,
    lossless: number,
    exact: number,
  ): number;
}

/** Encodes width x height RGBA bytes (straight alpha, as given) to lossy WebP. */
export function encodeWebP(
  rgba: Uint8Array,
  width: number,
  height: number,
  quality: number,
  method = 4,
): Uint8Array {
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `invalid RGBA length: expected ${width * height * 4}, got ${rgba.length}`,
    );
  }
  // A fresh instance per encode, like the Go wrapper, so memory is released.
  let mem: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module(), {
    wasi_snapshot_preview1: {
      fd_close: () => 0,
      fd_write: (
        _fd: number,
        iovs: number,
        iovsLen: number,
        nwrittenPtr: number,
      ) => {
        const dv = new DataView(mem.buffer);
        let written = 0;
        for (let i = 0; i < iovsLen; i++)
          written += dv.getUint32(iovs + i * 8 + 4, true);
        dv.setUint32(nwrittenPtr, written, true);
        return 0;
      },
    },
  });
  const ex = instance.exports as unknown as WebPExports;
  mem = ex.memory;
  ex._initialize();

  const inPtr = ex.malloc(rgba.length);
  if (inPtr === 0) throw new Error("webp: malloc failed");
  new Uint8Array(ex.memory.buffer, inPtr, rgba.length).set(rgba);
  const sizePtr = ex.malloc(8);
  const outPtr = ex.encode(
    inPtr,
    width,
    height,
    sizePtr,
    0,
    quality,
    method,
    0,
    0,
  );
  const size = Number(
    new DataView(ex.memory.buffer).getBigUint64(sizePtr, true),
  );
  if (size === 0 || outPtr === 0) throw new Error("webp: encode failed");
  return new Uint8Array(ex.memory.buffer, outPtr, size).slice();
}
