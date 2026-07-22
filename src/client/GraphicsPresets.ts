import { UserSettings } from "../core/game/UserSettings";
import { GraphicsOverridesSchema, type GraphicsOverrides } from "./render/gl";
import builtinPresets from "./render/gl/graphics-presets.json";
import { translateText } from "./Utils";

// Built-in presets, defined in graphics-presets.json — each entry's overrides
// are schema-parsed at load (JSON imports can't carry the palette enum's
// literal types). Overrides are applied wholesale. Night's ambient 0.36 is
// the graphics modal slider's level 8.
export const BUILTIN_PRESETS: ReadonlyArray<{
  nameKey: string;
  descKey: string;
  overrides: GraphicsOverrides;
}> = builtinPresets.map((preset) => ({
  nameKey: preset.nameKey,
  descKey: preset.descKey,
  overrides: GraphicsOverridesSchema.parse(preset.overrides),
}));

// Serialize with recursively sorted keys so preset equality doesn't depend on
// the order the settings were touched in.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Parse player-pasted settings JSON. Returns null unless the text is valid
 * JSON the schema recognizes in full. The schema strips unknown keys (needed
 * to read legacy stored data), which would let a mistyped paste apply as an
 * empty or partial config — so anything the parse dropped rejects the import
 * instead.
 */
export function parseGraphicsOverridesJson(
  text: string,
): GraphicsOverrides | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = GraphicsOverridesSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (stableStringify(parsed.data) !== stableStringify(raw)) return null;
  return parsed.data;
}

/**
 * One-time migration for players who tuned their graphics before presets
 * existed: snapshot their current custom settings as a saved preset so
 * applying a preset can never lose them. Writing the presets key (even as
 * {}) marks the migration as done.
 *
 * Runs at game start and again from the preset selector right before it
 * applies anything — the main-menu selector is reachable before any game
 * starts, and the snapshot must exist before the first wholesale overwrite.
 */
export function migrateLegacyGraphicsSettings(
  userSettings: UserSettings,
): void {
  if (userSettings.hasGraphicsPresets()) return;
  // The old colorblind toggle stored only a boolean (surfaced as
  // palette: "colorblind" by graphicsOverrides()); the Okabe-Ito friend-foe
  // border colors it hardcoded are now override data carried by the
  // Colorblind preset. Graft them onto any legacy colorblind config — not
  // just palette-only ones — so those players keep the blue/orange borders
  // alongside whatever else they customized.
  let current = userSettings.graphicsOverrides();
  const colorblind = BUILTIN_PRESETS.find(
    (preset) => preset.nameKey === "graphics_setting.preset_colorblind",
  );
  if (current.palette === "colorblind" && colorblind !== undefined) {
    current = {
      ...current,
      affiliation: {
        ...colorblind.overrides.affiliation,
        ...current.affiliation,
      },
      mapOverlay: {
        ...colorblind.overrides.mapOverlay,
        ...current.mapOverlay,
      },
    };
    userSettings.setGraphicsOverrides(current);
  }
  const isCustom =
    Object.keys(current).length > 0 &&
    !BUILTIN_PRESETS.some(
      (preset) =>
        stableStringify(preset.overrides) === stableStringify(current),
    );
  userSettings.setGraphicsPresets(
    isCustom
      ? { [translateText("graphics_setting.preset_migrated_name")]: current }
      : {},
  );
}
