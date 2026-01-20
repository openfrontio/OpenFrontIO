export type TerrainShaderId = "classic" | "improved-lite" | "improved-heavy";

export type TerrainShaderOption =
  | {
      kind: "boolean";
      key: string;
      label: string;
      defaultValue: boolean;
    }
  | {
      kind: "range";
      key: string;
      label: string;
      defaultValue: number;
      min: number;
      max: number;
      step: number;
    }
  | {
      kind: "enum";
      key: string;
      label: string;
      defaultValue: number;
      options: Array<{ value: number; label: string }>;
    };

export interface TerrainShaderDefinition {
  id: TerrainShaderId;
  label: string;
  wgslPath: string;
  options: TerrainShaderOption[];
}

export const TERRAIN_SHADER_KEY = "settings.webgpu.terrain.shader";

export const TERRAIN_SHADERS: TerrainShaderDefinition[] = [
  {
    id: "classic",
    label: "Classic",
    wgslPath: "compute/terrain-compute.wgsl",
    options: [],
  },
  {
    id: "improved-lite",
    label: "Improved (Lite)",
    wgslPath: "compute/terrain-compute-improved-lite.wgsl",
    options: [
      {
        kind: "range",
        key: "settings.webgpu.terrain.improvedLite.noiseStrength",
        label: "Noise Strength",
        defaultValue: 0.025,
        min: 0,
        max: 0.08,
        step: 0.005,
      },
      {
        kind: "range",
        key: "settings.webgpu.terrain.improvedLite.blendWidth",
        label: "Biome Blend Width",
        defaultValue: 2.5,
        min: 0.5,
        max: 5,
        step: 0.25,
      },
    ],
  },
  {
    id: "improved-heavy",
    label: "Improved (Heavy)",
    wgslPath: "compute/terrain-compute-improved-heavy.wgsl",
    options: [
      {
        kind: "range",
        key: "settings.webgpu.terrain.improvedHeavy.noiseStrength",
        label: "Noise Strength",
        defaultValue: 0.025,
        min: 0,
        max: 0.1,
        step: 0.005,
      },
      {
        kind: "range",
        key: "settings.webgpu.terrain.improvedHeavy.detailNoiseStrength",
        label: "Detail Noise Strength",
        defaultValue: 0.015,
        min: 0,
        max: 0.08,
        step: 0.005,
      },
      {
        kind: "range",
        key: "settings.webgpu.terrain.improvedHeavy.blendWidth",
        label: "Biome Blend Width",
        defaultValue: 2.8,
        min: 0.5,
        max: 6,
        step: 0.25,
      },
      {
        kind: "range",
        key: "settings.webgpu.terrain.improvedHeavy.lightingStrength",
        label: "Lighting Strength",
        defaultValue: 0.9,
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: "range",
        key: "settings.webgpu.terrain.improvedHeavy.cavityStrength",
        label: "Cavity Strength",
        defaultValue: 0.6,
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
];

export function getTerrainShaderById(
  id: TerrainShaderId,
): TerrainShaderDefinition {
  const found = TERRAIN_SHADERS.find((s) => s.id === id);
  if (!found) {
    throw new Error(`Unknown terrain shader: ${id}`);
  }
  return found;
}

export function terrainShaderIdFromInt(value: number): TerrainShaderId {
  if (value === 1) return "improved-lite";
  if (value === 2) return "improved-heavy";
  return "classic";
}

export function terrainShaderIntFromId(id: TerrainShaderId): number {
  if (id === "improved-lite") return 1;
  if (id === "improved-heavy") return 2;
  return 0;
}

export function readTerrainShaderId(userSettings: {
  getInt: (key: string, defaultValue: number) => number;
}): TerrainShaderId {
  return terrainShaderIdFromInt(userSettings.getInt(TERRAIN_SHADER_KEY, 0));
}

export function buildTerrainShaderParams(
  userSettings: {
    getFloat: (key: string, defaultValue: number) => number;
  },
  shaderId: TerrainShaderId,
): { shaderPath: string; params0: Float32Array; params1: Float32Array } {
  const shorelineMixLand = 0.6;
  const shorelineMixWater = 0.7;
  const specularStrength = 0.05;

  if (shaderId === "improved-lite") {
    const noiseStrength = userSettings.getFloat(
      "settings.webgpu.terrain.improvedLite.noiseStrength",
      0.025,
    );
    const blendWidth = userSettings.getFloat(
      "settings.webgpu.terrain.improvedLite.blendWidth",
      2.5,
    );

    const params0 = new Float32Array([
      noiseStrength,
      blendWidth,
      shorelineMixLand,
      shorelineMixWater,
    ]);
    const params1 = new Float32Array([0, 0, 0, specularStrength]);
    return {
      shaderPath: "compute/terrain-compute-improved-lite.wgsl",
      params0,
      params1,
    };
  }

  if (shaderId === "improved-heavy") {
    const noiseStrength = userSettings.getFloat(
      "settings.webgpu.terrain.improvedHeavy.noiseStrength",
      0.025,
    );
    const detailNoiseStrength = userSettings.getFloat(
      "settings.webgpu.terrain.improvedHeavy.detailNoiseStrength",
      0.015,
    );
    const blendWidth = userSettings.getFloat(
      "settings.webgpu.terrain.improvedHeavy.blendWidth",
      2.8,
    );
    const lightingStrength = userSettings.getFloat(
      "settings.webgpu.terrain.improvedHeavy.lightingStrength",
      0.9,
    );
    const cavityStrength = userSettings.getFloat(
      "settings.webgpu.terrain.improvedHeavy.cavityStrength",
      0.6,
    );

    const params0 = new Float32Array([
      noiseStrength,
      blendWidth,
      shorelineMixLand,
      shorelineMixWater,
    ]);
    const params1 = new Float32Array([
      detailNoiseStrength,
      lightingStrength,
      cavityStrength,
      specularStrength,
    ]);
    return {
      shaderPath: "compute/terrain-compute-improved-heavy.wgsl",
      params0,
      params1,
    };
  }

  const params0 = new Float32Array([
    0,
    2.5,
    shorelineMixLand,
    shorelineMixWater,
  ]);
  const params1 = new Float32Array([0, 0, 0, specularStrength]);
  return { shaderPath: "compute/terrain-compute.wgsl", params0, params1 };
}
