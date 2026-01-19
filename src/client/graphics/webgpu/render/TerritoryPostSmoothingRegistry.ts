import { TerritoryShaderOption } from "./TerritoryShaderRegistry";

export type TerritoryPostSmoothingId = "off" | "fade" | "dissolve";

export interface TerritoryPostSmoothingDefinition {
  id: TerritoryPostSmoothingId;
  label: string;
  wgslPath: string;
  options: TerritoryShaderOption[];
}

export const TERRITORY_POST_SMOOTHING_KEY =
  "settings.webgpu.territory.smoothing.post";

export const TERRITORY_POST_SMOOTHING: TerritoryPostSmoothingDefinition[] = [
  {
    id: "off",
    label: "Off",
    wgslPath: "",
    options: [],
  },
  {
    id: "fade",
    label: "Fade",
    wgslPath: "render/temporal-resolve.wgsl",
    options: [
      {
        kind: "range",
        key: "settings.webgpu.territory.postSmoothing.blendStrength",
        label: "Blend Strength",
        defaultValue: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    id: "dissolve",
    label: "Dissolve",
    wgslPath: "render/temporal-resolve.wgsl",
    options: [
      {
        kind: "range",
        key: "settings.webgpu.territory.postSmoothing.blendStrength",
        label: "Blend Strength",
        defaultValue: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.postSmoothing.dissolveWidth",
        label: "Dissolve Width",
        defaultValue: 0.08,
        min: 0.01,
        max: 0.4,
        step: 0.01,
      },
    ],
  },
];

export function territoryPostSmoothingIdFromInt(
  value: number,
): TerritoryPostSmoothingId {
  if (value === 1) return "fade";
  if (value === 2) return "dissolve";
  return "off";
}

export function territoryPostSmoothingIntFromId(
  id: TerritoryPostSmoothingId,
): number {
  if (id === "fade") return 1;
  if (id === "dissolve") return 2;
  return 0;
}

export function readTerritoryPostSmoothingId(userSettings: {
  getInt: (key: string, defaultValue: number) => number;
}): TerritoryPostSmoothingId {
  return territoryPostSmoothingIdFromInt(
    userSettings.getInt(TERRITORY_POST_SMOOTHING_KEY, 0),
  );
}

export function buildTerritoryPostSmoothingParams(
  userSettings: {
    getFloat: (key: string, defaultValue: number) => number;
  },
  smoothingId: TerritoryPostSmoothingId,
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

  const blendStrength = userSettings.getFloat(
    "settings.webgpu.territory.postSmoothing.blendStrength",
    1,
  );
  const dissolveWidth = userSettings.getFloat(
    "settings.webgpu.territory.postSmoothing.dissolveWidth",
    0.08,
  );

  const mode = smoothingId === "fade" ? 1 : 2;
  const params0 = new Float32Array([mode, blendStrength, dissolveWidth, 0]);
  const params1 = new Float32Array([0, 0, 0, 0]);

  return {
    enabled: true,
    shaderPath: "render/temporal-resolve.wgsl",
    params0,
    params1,
  };
}
