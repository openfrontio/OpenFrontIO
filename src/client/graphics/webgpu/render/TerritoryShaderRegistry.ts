export type TerritoryShaderId = "classic" | "retro";

export type TerritoryShaderOption =
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

export interface TerritoryShaderDefinition {
  id: TerritoryShaderId;
  label: string;
  wgslPath: string;
  options: TerritoryShaderOption[];
}

export const TERRITORY_SHADER_KEY = "settings.webgpu.territory.shader";

export const TERRITORY_SHADERS: TerritoryShaderDefinition[] = [
  {
    id: "classic",
    label: "Simple",
    wgslPath: "render/territory.wgsl",
    options: [
      {
        kind: "enum",
        key: "settings.webgpu.territory.classic.borderMode",
        label: "Border Mode",
        defaultValue: 1,
        options: [
          { value: 0, label: "Off" },
          { value: 1, label: "Simple" },
          { value: 2, label: "Glow" },
        ],
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.classic.thicknessPx",
        label: "Thickness (px)",
        defaultValue: 1,
        min: 0.5,
        max: 8,
        step: 0.5,
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.classic.borderStrength",
        label: "Border Strength",
        defaultValue: 0.64,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.classic.glowStrength",
        label: "Glow Strength",
        defaultValue: 0.42,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.classic.glowRadiusMul",
        label: "Glow Radius",
        defaultValue: 1,
        min: 1,
        max: 12,
        step: 0.25,
      },
      {
        kind: "boolean",
        key: "settings.webgpu.territory.classic.drawDefendedRadius",
        label: "Draw Defended Radius",
        defaultValue: false,
      },
      {
        kind: "boolean",
        key: "settings.webgpu.territory.classic.disableDefendedTint",
        label: "Disable Defended Tint",
        defaultValue: false,
      },
    ],
  },
  {
    id: "retro",
    label: "Retro",
    wgslPath: "render/retro.wgsl",
    options: [
      {
        kind: "boolean",
        key: "settings.webgpu.territory.retro.colorByRelations",
        label: "Color By Player Relations",
        defaultValue: true,
      },
      {
        kind: "boolean",
        key: "settings.webgpu.territory.retro.patternWhenDefended",
        label: "Pattern When In Defended Range",
        defaultValue: true,
      },
      {
        kind: "boolean",
        key: "settings.webgpu.territory.retro.splitBorder",
        label: "Split Border",
        defaultValue: true,
      },
      {
        kind: "boolean",
        key: "settings.webgpu.territory.retro.drawDefendedRadius",
        label: "Draw Defended Radius",
        defaultValue: true,
      },
      {
        kind: "boolean",
        key: "settings.webgpu.territory.retro.disableDefendedTint",
        label: "Disable Defended Tint",
        defaultValue: true,
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.retro.thicknessPx",
        label: "Thickness (px)",
        defaultValue: 6,
        min: 0.5,
        max: 12,
        step: 0.5,
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.retro.borderStrength",
        label: "Border Strength",
        defaultValue: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.retro.glowStrength",
        label: "Glow Strength",
        defaultValue: 0,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.retro.glowRadiusMul",
        label: "Glow Radius",
        defaultValue: 1,
        min: 1,
        max: 16,
        step: 0.25,
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.retro.relationTintStrength",
        label: "Relation Tint Strength",
        defaultValue: 1,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.retro.defendedPatternStrength",
        label: "Defended Pattern Strength",
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: "range",
        key: "settings.webgpu.territory.retro.defendedThreshold",
        label: "Defended Threshold",
        defaultValue: 0.01,
        min: 0.01,
        max: 1,
        step: 0.01,
      },
    ],
  },
];

export function getTerritoryShaderById(
  id: TerritoryShaderId,
): TerritoryShaderDefinition {
  const found = TERRITORY_SHADERS.find((s) => s.id === id);
  if (!found) {
    throw new Error(`Unknown territory shader: ${id}`);
  }
  return found;
}

export function territoryShaderIdFromInt(value: number): TerritoryShaderId {
  return value === 1 ? "retro" : "classic";
}

export function territoryShaderIntFromId(id: TerritoryShaderId): number {
  return id === "retro" ? 1 : 0;
}

export function readTerritoryShaderId(userSettings: {
  getInt: (key: string, defaultValue: number) => number;
}): TerritoryShaderId {
  return territoryShaderIdFromInt(userSettings.getInt(TERRITORY_SHADER_KEY, 0));
}

export function buildTerritoryShaderParams(
  userSettings: {
    get: (key: string, defaultValue: boolean) => boolean;
    getFloat: (key: string, defaultValue: number) => number;
    getInt: (key: string, defaultValue: number) => number;
  },
  shaderId: TerritoryShaderId,
): { shaderPath: string; params0: Float32Array; params1: Float32Array } {
  if (shaderId === "retro") {
    const thicknessPx = userSettings.getFloat(
      "settings.webgpu.territory.retro.thicknessPx",
      6,
    );
    const borderStrength = userSettings.getFloat(
      "settings.webgpu.territory.retro.borderStrength",
      1,
    );
    const glowStrength = userSettings.getFloat(
      "settings.webgpu.territory.retro.glowStrength",
      0,
    );
    const glowRadiusMul = userSettings.getFloat(
      "settings.webgpu.territory.retro.glowRadiusMul",
      1,
    );

    const colorByRelations = userSettings.get(
      "settings.webgpu.territory.retro.colorByRelations",
      true,
    );
    const patternWhenDefended = userSettings.get(
      "settings.webgpu.territory.retro.patternWhenDefended",
      true,
    );
    const splitBorder = userSettings.get(
      "settings.webgpu.territory.retro.splitBorder",
      true,
    );
    const drawDefendedRadius = userSettings.get(
      "settings.webgpu.territory.retro.drawDefendedRadius",
      true,
    );
    const disableDefendedTint = userSettings.get(
      "settings.webgpu.territory.retro.disableDefendedTint",
      true,
    );
    const relationTintStrength = userSettings.getFloat(
      "settings.webgpu.territory.retro.relationTintStrength",
      1,
    );
    const defendedPatternStrength = userSettings.getFloat(
      "settings.webgpu.territory.retro.defendedPatternStrength",
      0.5,
    );
    const defendedThreshold = userSettings.getFloat(
      "settings.webgpu.territory.retro.defendedThreshold",
      0.01,
    );

    let flags = 0;
    if (colorByRelations) flags |= 1 << 0;
    if (patternWhenDefended) flags |= 1 << 1;
    if (splitBorder) flags |= 1 << 2;
    if (drawDefendedRadius) flags |= 1 << 3;
    if (disableDefendedTint) flags |= 1 << 4;

    const params0 = new Float32Array([
      thicknessPx,
      borderStrength,
      glowStrength,
      glowRadiusMul,
    ]);
    const params1 = new Float32Array([
      flags,
      relationTintStrength,
      defendedPatternStrength,
      defendedThreshold,
    ]);

    return { shaderPath: "render/retro.wgsl", params0, params1 };
  }

  const borderMode = userSettings.getInt(
    "settings.webgpu.territory.classic.borderMode",
    1,
  );
  const thicknessPx = userSettings.getFloat(
    "settings.webgpu.territory.classic.thicknessPx",
    1,
  );
  const borderStrength = userSettings.getFloat(
    "settings.webgpu.territory.classic.borderStrength",
    0.64,
  );
  const glowStrength = userSettings.getFloat(
    "settings.webgpu.territory.classic.glowStrength",
    0.42,
  );
  const glowRadiusMul = userSettings.getFloat(
    "settings.webgpu.territory.classic.glowRadiusMul",
    1,
  );
  const drawDefendedRadius = userSettings.get(
    "settings.webgpu.territory.classic.drawDefendedRadius",
    false,
  );
  const disableDefendedTint = userSettings.get(
    "settings.webgpu.territory.classic.disableDefendedTint",
    false,
  );

  const params0 = new Float32Array([
    borderMode,
    thicknessPx,
    borderStrength,
    glowStrength,
  ]);
  const params1 = new Float32Array([
    glowRadiusMul,
    drawDefendedRadius ? 1 : 0,
    disableDefendedTint ? 1 : 0,
    0,
  ]);
  return { shaderPath: "render/territory.wgsl", params0, params1 };
}
