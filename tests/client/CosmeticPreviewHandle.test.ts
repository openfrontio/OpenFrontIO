// The handle mountCosmeticPreview returns, with the WebGL component swapped
// for a stub: the lifecycle is what is under test, not rendering.

const zoomIn = vi.fn();

vi.mock("../../src/client/components/cosmetics/CosmeticRenderCanvas", () => {
  class StubRenderCanvas extends HTMLElement {
    resolved: unknown;
    zoomIn = zoomIn;
    zoomOut = vi.fn();
  }
  customElements.define("cosmetic-render-canvas", StubRenderCanvas);
  return {};
});

const { previewModule } =
  await import("../../src/client/cosmetic-preview/preview");
const { mountCosmeticPreview } = previewModule;

// An 8x8 pattern at scale 1 with diagonal stripes.
const PATTERN = "ADEYB4PB4HA4HA4";

describe("mountCosmeticPreview", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    zoomIn.mockClear();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("mounts one canvas on the first valid request", () => {
    host.append(document.createElement("p"));
    const { result } = mountCosmeticPreview(host, {
      type: "pattern",
      pattern: PATTERN,
    });
    expect(result).toEqual({ ok: true });
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild?.tagName).toBe("COSMETIC-RENDER-CANVAS");
  });

  test("an invalid first request leaves the host alone", () => {
    const placeholder = document.createElement("p");
    host.append(placeholder);
    const { result } = mountCosmeticPreview(host, {
      type: "skin",
      url: "http://insecure.example/s.png",
    });
    expect(result.ok).toBe(false);
    expect(host.firstElementChild).toBe(placeholder);
  });

  test("show() switches cosmetic on the same canvas", () => {
    const { handle } = mountCosmeticPreview(host, {
      type: "pattern",
      pattern: PATTERN,
    });
    const canvas = host.firstElementChild;
    expect(
      handle.show({
        type: "pattern",
        pattern: PATTERN,
        colors: ["#ff7f0e", "#06b6d4"],
      }),
    ).toEqual({ ok: true });
    expect(host.firstElementChild).toBe(canvas);
  });

  test("mounts once even while the host is not yet in the page", () => {
    host.remove();
    const { handle } = mountCosmeticPreview(host, {
      type: "pattern",
      pattern: PATTERN,
    });
    const canvas = host.firstElementChild;
    const sibling = document.createElement("span");
    host.append(sibling);
    handle.show({ type: "pattern", pattern: PATTERN });
    expect(host.firstElementChild).toBe(canvas);
    expect(host.lastElementChild).toBe(sibling);
  });

  test("destroy() is final: show() refuses and the host is left alone", () => {
    const { handle } = mountCosmeticPreview(host, {
      type: "pattern",
      pattern: PATTERN,
    });
    handle.destroy();
    expect(host.children).toHaveLength(0);

    const hostContent = document.createElement("p");
    host.append(hostContent);
    const result = handle.show({ type: "pattern", pattern: PATTERN });
    expect(result.ok).toBe(false);
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild).toBe(hostContent);

    handle.zoomIn();
    expect(zoomIn).not.toHaveBeenCalled();
  });
});
