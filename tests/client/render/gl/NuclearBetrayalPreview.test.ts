import { describe, expect, test, vi } from "vitest";
import { GPURenderer } from "../../../../src/client/render/gl/Renderer";
import { CrosshairPass } from "../../../../src/client/render/gl/passes/CrosshairPass";
import { RangeCirclePass } from "../../../../src/client/render/gl/passes/RangeCirclePass";
import { GhostPreviewData } from "../../../../src/client/render/types";

vi.mock("../../../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

const ghost = {
  ghostType: "Atom Bomb",
  tileX: 3,
  tileY: 4,
  radiusTileX: 3,
  radiusTileY: 4,
  rangeRadius: 10,
  rangeWarning: true,
  betrayalBlocked: true,
  canBuild: false,
  canUpgrade: false,
  canAfford: false,
  showCost: false,
  cost: 100,
} as GhostPreviewData;

function makeGL() {
  return {
    useProgram: vi.fn(),
    uniformMatrix3fv: vi.fn(),
    bindVertexArray: vi.fn(),
    uniform2f: vi.fn(),
    uniform1f: vi.fn(),
    uniform3f: vi.fn(),
    drawArrays: vi.fn(),
  };
}

describe("blocked nuclear previews", () => {
  test("renders the blocked blast circle gray and restores the red warning when disabled", () => {
    const gl = makeGL();
    const pass = Object.create(RangeCirclePass.prototype) as RangeCirclePass;
    Object.assign(pass, { gl, uColor: "color" });
    pass.updateGhostPreview(ghost);
    pass.draw(new Float32Array(9));
    expect(gl.uniform3f).toHaveBeenLastCalledWith("color", 0.6, 0.6, 0.6);
    pass.updateGhostPreview({ ...ghost, betrayalBlocked: false });
    pass.draw(new Float32Array(9));
    expect(gl.uniform3f).toHaveBeenLastCalledWith("color", 1, 0.2, 0.2);
  });

  test.each(["Atom Bomb", "Hydrogen Bomb", "MIRV"])(
    "renders a persistent gray X for a blocked %s",
    (ghostType) => {
      const gl = makeGL();
      const pass = Object.create(CrosshairPass.prototype) as CrosshairPass;
      Object.assign(pass, { gl, uColor: "color", uIsDiagonal: "diagonal" });
      pass.updateGhostPreview({ ...ghost, ghostType });
      pass.draw(new Float32Array(9));
      expect(gl.uniform3f).toHaveBeenLastCalledWith("color", 0.6, 0.6, 0.6);
      expect(gl.uniform1f).toHaveBeenCalledWith("diagonal", 1);
    },
  );

  test("shows the gray explanation even when cursor prices are hidden and gold is insufficient", () => {
    const renderer = Object.create(GPURenderer.prototype) as GPURenderer;
    const setGhostCostLabel = vi.fn();
    const pass = { updateGhostPreview: vi.fn() };
    Object.assign(renderer, {
      structurePass: pass,
      railroadPass: pass,
      rangeCirclePass: pass,
      crosshairPass: pass,
      worldTextPass: { setGhostCostLabel },
      samRadiusPass: { setVisible: vi.fn() },
    });
    renderer.updateGhostPreview(ghost);
    expect(setGhostCostLabel).toHaveBeenLastCalledWith({
      tileX: 3,
      tileY: 4,
      cost: 0,
      canAfford: true,
      canPlace: false,
      topText: "user_setting.nuclear_betrayal_blocked_short",
    });
    renderer.updateGhostPreview({ ...ghost, betrayalBlocked: false });
    expect(setGhostCostLabel).toHaveBeenLastCalledWith(null);
  });
});
