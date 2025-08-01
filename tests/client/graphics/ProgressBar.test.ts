/**
 * @jest-environment jsdom
 */
import { ProgressBar } from "../../../src/client/graphics/ProgressBar";

import { jest } from "@jest/globals";

describe("ProgressBar", () => {
  let ctx: CanvasRenderingContext2D;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 20;
    ctx = canvas.getContext("2d")!;
  });

  it("should initialize and draw the background", () => {
    const spyClearRect = jest.spyOn(ctx, "clearRect");
    const spyFillRect = jest.spyOn(ctx, "fillRect");
    const spyFillStyle = jest.spyOn(ctx, "fillStyle", "set");
    const bar = new ProgressBar(["#ff0000", "#00ff00"], ctx, 2, 2, 80, 10, 0.5);
    expect(spyClearRect).toHaveBeenCalledWith(0, 0, 82, 12);
    expect(spyFillRect).toHaveBeenCalledWith(1, 1, 80, 10);
    expect(spyFillStyle).toHaveBeenCalledWith("#00ff00");
    expect(bar.getX()).toBe(2);
    expect(bar.getY()).toBe(2);
  });

  it("should set progress and draw the progress bar", () => {
    const bar = new ProgressBar(["#ff0000", "#00ff00"], ctx, 2, 2, 80, 10);
    const spyFillRect = jest.spyOn(ctx, "fillRect");
    bar.setProgress(0.5);
    expect(bar.getProgress()).toBe(0.5);
    expect(spyFillRect).toHaveBeenCalledWith(
      2,
      2,
      Math.floor(0.5 * (80 - 2)),
      8,
    );
    expect(ctx.fillStyle).toBe("#00ff00");

    bar.setProgress(0.1);
    expect(ctx.fillStyle).toBe("#ff0000");
  });

  it("should clamp progress between 0 and 1 on init", () => {
    const bar = new ProgressBar(["#ff0000", "#00ff00"], ctx, 2, 2, 80, 10, -1);
    expect(bar.getProgress()).toBe(0);
    const bar2 = new ProgressBar(["#ff0000", "#00ff00"], ctx, 2, 2, 80, 10, 2);
    expect(bar2.getProgress()).toBe(1);
  });

  it("should handle empty colors array gracefully", () => {
    const bar = new ProgressBar([], ctx, 2, 2, 80, 10, 0.5);
    expect(() => bar.setProgress(0.5)).not.toThrow();
    expect(ctx.fillStyle).toBe("#808080");
  });
});
