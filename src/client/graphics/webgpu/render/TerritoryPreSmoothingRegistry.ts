import { TerritoryShaderOption } from "./TerritoryShaderRegistry";

export type TerritoryPreSmoothingId = "off" | "dissolve" | "budget";

export interface TerritoryPreSmoothingDefinition {
  id: TerritoryPreSmoothingId;
  label: string;
  wgslPath: string;
  options: TerritoryShaderOption[];
}

export const TERRITORY_PRE_SMOOTHING_KEY =
  "settings.webgpu.territory.smoothing.pre";

export const TERRITORY_PRE_SMOOTHING: TerritoryPreSmoothingDefinition[] = [
  {
    id: "off",
    label: "Off",
    wgslPath: "",
    options: [],
  },
  {
    id: "dissolve",
    label: "Dissolve",
    wgslPath: "compute/visual-state-smoothing.wgsl",
    options: [
      {
        kind: "range",
        key: "settings.webgpu.territory.preSmoothing.curveExp",
        label: "Reveal Curve",
        defaultValue: 1,
        min: 0.25,
        max: 3,
        step: 0.05,
      },
    ],
  },
  {
    id: "budget",
    label: "Budgeted Reveal",
    wgslPath: "compute/visual-state-smoothing.wgsl",
    options: [
      {
        kind: "range",
        key: "settings.webgpu.territory.preSmoothing.curveExp",
        label: "Reveal Curve",
        defaultValue: 1,
        min: 0.25,
        max: 3,
        step: 0.05,
      },
    ],
  },
];

export function territoryPreSmoothingIdFromInt(
  value: number,
): TerritoryPreSmoothingId {
  if (value === 1) return "dissolve";
  if (value === 2) return "budget";
  return "off";
}

export function territoryPreSmoothingIntFromId(
  id: TerritoryPreSmoothingId,
): number {
  if (id === "dissolve") return 1;
  if (id === "budget") return 2;
  return 0;
}

export function readTerritoryPreSmoothingId(userSettings: {
  getInt: (key: string, defaultValue: number) => number;
}): TerritoryPreSmoothingId {
  return territoryPreSmoothingIdFromInt(
    userSettings.getInt(TERRITORY_PRE_SMOOTHING_KEY, 0),
  );
}

export function buildTerritoryPreSmoothingParams(
  userSettings: {
    getFloat: (key: string, defaultValue: number) => number;
  },
  smoothingId: TerritoryPreSmoothingId,
): {
  enabled: boolean;
  shaderPath: string;
  params0: Float32Array;
  params1: Float32Array;
} {
  if (smoothingId === "off") {
    return {
      enabled: false,
      shaderPath: "",
      params0: new Float32Array(4),
      params1: new Float32Array(4),
    };
  }

  const curveExp = userSettings.getFloat(
    "settings.webgpu.territory.preSmoothing.curveExp",
    1,
  );
  const mode = smoothingId === "dissolve" ? 1 : 2;

  const params0 = new Float32Array([mode, curveExp, 0, 0]);
  const params1 = new Float32Array([0, 0, 0, 0]);
  return {
    enabled: true,
    shaderPath: "compute/visual-state-smoothing.wgsl",
    params0,
    params1,
  };
}
