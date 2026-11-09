/**
 * The host APIs the engine may use, which every browser, worker and Node
 * has. The engine packages compile against ES2022 and this file instead of
 * the DOM, WebWorker or Node types, so any other host API (fetch,
 * createImageBitmap, self, process...) fails to type-check. The worker
 * entry, which talks to the page, compiles with the WebWorker lib
 * (packages/engine/src/worker/tsconfig.json).
 */

interface Console {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
}
declare const console: Console;

/** For timing logs and debug spans; never feeds the game's state. */
interface Performance {
  now(): number;
  measure(
    name: string,
    options?: { start?: number; end?: number; detail?: unknown },
  ): unknown;
}
declare const performance: Performance;

interface TextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer>;
  encodeInto(
    source: string,
    destination: Uint8Array,
  ): { read: number; written: number };
}
declare const TextEncoder: { new (): TextEncoder };

interface TextDecoder {
  decode(input?: Uint8Array): string;
}
declare const TextDecoder: {
  new (label?: string, options?: { fatal?: boolean }): TextDecoder;
};
