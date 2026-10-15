/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Firefox rejects CSSStyleSheet.replace() with NotAllowedError while an
// earlier replace() on the same sheet is still pending. This stub does the
// same, so an overlapping populate shows up as a rejected replace().
class StrictSheet {
  static instances: StrictSheet[] = [];
  text = "";
  pending = false;
  overlaps = 0;
  constructor() {
    StrictSheet.instances.push(this);
  }
  replace(text: string): Promise<StrictSheet> {
    if (this.pending) {
      this.overlaps++;
      return Promise.reject(
        new DOMException(
          "Can only call replace on modifiable style sheets",
          "NotAllowedError",
        ),
      );
    }
    this.pending = true;
    return new Promise((resolve) =>
      setTimeout(() => {
        this.pending = false;
        this.text = text;
        resolve(this);
      }, 5),
    );
  }
}

describe("documentStylesSheet", () => {
  let fetchCount = 0;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    vi.resetModules();
    StrictSheet.instances = [];
    fetchCount = 0;
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
    vi.stubGlobal("CSSStyleSheet", StrictSheet);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const n = ++fetchCount;
        await new Promise((r) => setTimeout(r, 1));
        return new Response(`.css-${n} {}`);
      }),
    );
    Object.defineProperty(document, "readyState", {
      configurable: true,
      get: () => "loading",
    });
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.example/styles.css";
    document.head.appendChild(link);
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    vi.unstubAllGlobals();
    delete (document as { readyState?: string }).readyState;
    document.head.innerHTML = "";
  });

  it("does not overlap the initial and DOMContentLoaded populates", async () => {
    const { documentStylesSheet } =
      await import("../../../src/client/components/baseComponents/SharedStyles");
    documentStylesSheet();
    document.dispatchEvent(new Event("DOMContentLoaded"));

    await vi.waitFor(() => expect(fetchCount).toBe(2));
    const sheet = StrictSheet.instances[0];
    await vi.waitFor(() => expect(sheet.text).toBe(".css-2 {}"));
    await new Promise((r) => setTimeout(r, 20));

    expect(sheet.overlaps).toBe(0);
    expect(unhandled).toEqual([]);
    expect(sheet.text).toBe(".css-2 {}");
  });

  it("swallows a failed replace instead of leaving it unhandled", async () => {
    vi.spyOn(StrictSheet.prototype, "replace").mockRejectedValue(
      new Error("replace failed"),
    );
    const { documentStylesSheet } =
      await import("../../../src/client/components/baseComponents/SharedStyles");
    documentStylesSheet();
    document.dispatchEvent(new Event("DOMContentLoaded"));

    await vi.waitFor(() => expect(fetchCount).toBe(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).toEqual([]);
  });
});
