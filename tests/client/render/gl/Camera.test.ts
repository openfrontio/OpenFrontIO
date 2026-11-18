import { describe, expect, it } from "vitest";
import { Camera } from "../../../../src/client/render/gl/Camera";

describe("Camera", () => {
  it("uses standard min zoom (0.2) for standard map sizes", () => {
    const cam = new Camera(1000, 1000);
    cam.resize(1920, 1080);
    expect(cam.minZoom).toBe(0.2);
  });

  it("scales minZoom dynamically for massive maps like World 10000", () => {
    const cam = new Camera(10000, 5000);
    cam.resize(1920, 1080);
    // 1920 / 10000 * 0.9 = 0.1728, which is < 0.2
    expect(cam.minZoom).toBeCloseTo(0.1728, 3);

    // Zooming out with zoomTo or zoomBy should be clamped to minZoom (< 0.2)
    cam.zoomTo(0.01);
    expect(cam.zoom).toBeCloseTo(0.1728, 3);
  });

  it("calculates visible world bounds correctly", () => {
    const cam = new Camera(10000, 5000);
    cam.resize(1000, 1000);
    cam.panTo(5000, 2500);
    cam.zoomTo(1);

    const bounds = cam.getWorldBounds();
    expect(bounds.minX).toBe(4500);
    expect(bounds.maxX).toBe(5500);
    expect(bounds.minY).toBe(2000);
    expect(bounds.maxY).toBe(3000);
  });
});
