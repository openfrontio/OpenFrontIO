/**
 * @jest-environment jsdom
 */

import { NukePreview } from "../../../src/client/graphics/layers/NukePreview";
import { UnitType } from "../../../src/core/game/Game";

type Ctx = CanvasRenderingContext2D & {
  _calls?: Record<string, number>;
};

function makeCtx(): Ctx {
  const fn = () => {};
  const ctx: any = {
    save: jest.fn(),
    restore: jest.fn(),
    setTransform: jest.fn(),
    beginPath: jest.fn(),
    setLineDash: jest.fn(),
    arc: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    fillRect: jest.fn(),
    // properties that get assigned in code:
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    lineDashOffset: 0,
    globalCompositeOperation: "source-over",
    imageSmoothingEnabled: true,
  };
  return ctx as Ctx;
}

const ownerObj = { isPlayer: () => true, id: () => 1 };

// Minimal GameView + Transform mocks used by NukePreview
function makeGameAndTransform() {
  const game: any = {
    ticks: jest.fn(() => 1234),
    isValidCoord: jest.fn(() => true),
    isLand: jest.fn(() => true),
    ref: jest.fn((x: number, y: number) => ({ x, y })), // opaque handle
    owner: jest.fn(() => ownerObj), // always same owner ref
    config: jest.fn(() => ({
      nukeMagnitudes: (type: any) => {
        // MIRV warheads are tiny, other nukes bigger
        if (type === UnitType.MIRVWarhead) return { inner: 2, outer: 4 };
        return { inner: 10, outer: 20 };
      },
    })),
  };

  const transform: any = {
    scale: 1,
    boundingRect: jest.fn(() => ({ left: 0, top: 0 })),
    // Return something simple; we don't care about exact math in this test
    worldToScreenCoordinates: jest.fn((_cell: any) => ({ x: 0, y: 0 })),
  };

  return { game, transform };
}

describe("NukePreview", () => {
  let ctx: Ctx;
  let game: any;
  let transform: any;
  let ui: any;
  let layer: NukePreview;

  beforeEach(() => {
    // Stable time so dashed ring math is deterministic
    jest.spyOn(performance, "now").mockReturnValue(1_234_567);

    ctx = makeCtx();
    const gt = makeGameAndTransform();
    game = gt.game;
    transform = gt.transform;

    ui = {
      nukePreview: undefined,
      nukeAnchor: undefined,
    };

    layer = new NukePreview(game, transform, ui);
  });

  afterEach(() => {
    (performance.now as unknown as jest.SpyInstance).mockRestore();
  });

  it("does nothing when inactive or no anchor", () => {
    layer.renderLayer(ctx);
    expect(ctx.beginPath).not.toHaveBeenCalled();

    ui.nukePreview = { active: true, nukeType: UnitType.AtomBomb };
    // still no anchor
    layer.renderLayer(ctx);
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });

  it("draws Atom Bomb preview (rings/band calls happen)", () => {
    ui.nukePreview = { active: true, nukeType: UnitType.AtomBomb };
    ui.nukeAnchor = { x: 100, y: 200 };

    layer.renderLayer(ctx);

    // Should have started paths at least a few times (inner ring, band safety, spinning rings)
    expect(ctx.beginPath).toHaveBeenCalled();

    // Non-MIRV uses 12/10 dash at least once for spinning rings
    const dashCalls = (ctx.setLineDash as jest.Mock).mock.calls;
    const has1210 = dashCalls.some(
      (c) => Array.isArray(c[0]) && c[0][0] === 12 && c[0][1] === 10,
    );
    expect(has1210).toBe(true);

    // Probabilistic band should draw some rects
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("draws MIRV preview with many mini-targets and MIRV dash pattern", () => {
    ui.nukePreview = { active: true, nukeType: UnitType.MIRV };
    ui.nukeAnchor = { x: 500, y: 500 };

    layer.renderLayer(ctx);

    // MIRV draws a lot of little arcs (two arcs per target). Expect a healthy amount.
    expect((ctx.arc as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(60);

    // MIRV uses [8,8] for tiny spinning rings
    const dashCalls = (ctx.setLineDash as jest.Mock).mock.calls;
    const has88 = dashCalls.some(
      (c) => Array.isArray(c[0]) && c[0][0] === 8 && c[0][1] === 8,
    );
    expect(has88).toBe(true);

    // Should not have used the non-MIRV ring dash in this path
    const has1210 = dashCalls.some(
      (c) => Array.isArray(c[0]) && c[0][0] === 12 && c[0][1] === 10,
    );
    expect(has1210).toBe(false);
  });
});
