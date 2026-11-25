import { vi } from "vitest";

// jsdom never loads images. This stand-in settles each one on the next
// microtask: an error for a src `broken` matches, a load otherwise.
export function installFakeImage(
  broken: (src: string) => boolean = () => false,
): string[] {
  const requested: string[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = "auto";
    private _src = "";
    get src(): string {
      return this._src;
    }
    set src(value: string) {
      this._src = value;
      requested.push(value);
      queueMicrotask(() => (broken(value) ? this.onerror : this.onload)?.());
    }
  }
  vi.stubGlobal("Image", FakeImage);
  return requested;
}
