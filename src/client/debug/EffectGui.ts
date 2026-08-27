/**
 * Effect Editor — a lil-gui panel for tuning cosmetic effects live in a
 * singleplayer game. Each folder edits one effect slot (trails, structures,
 * warship, nuke explosion) in the catalog's own attribute shape; enabling a
 * slot overrides the local player's equipped effect of that type via
 * WebGLFrameBuilder.setEffectOverride, so the result shows on your own
 * units / bombs. "Copy catalog JSON" puts a paste-ready entry on the
 * clipboard. Loaded on demand (see ClientGameRunner) to keep lil-gui out of
 * the main bundle.
 */

import GUI, { type Controller } from "lil-gui";
import {
  EFFECT_TYPES,
  type EffectType,
  NUKE_EXPLOSION_TYPES,
} from "../../core/CosmeticSchemas";
import { makeDraggable } from "../render/gl/debug/Wiring";
import { copyToClipboard } from "../Utils";
import type { EffectOverrideAttributes } from "../WebGLFrameBuilder";
import {
  catalogSnippet,
  defaultSlotState,
  EFFECT_GUI_MAX_COLORS,
  EFFECT_GUI_TYPES,
  type EffectSlotState,
  fieldsForType,
  slotAttributes,
} from "./EffectGuiState";

export interface EffectGuiHooks {
  setOverride<T extends EffectType>(
    effectType: T,
    attrs: EffectOverrideAttributes[T] | null,
  ): void;
}

const SLOT_LABELS: Record<EffectType, string> = {
  transportShipTrail: "Transport Ship Trail",
  nukeTrail: "Nuke Trail",
  structures: "Structures",
  warship: "Warship",
  nukeExplosion: "Nuke Explosion",
};

type NumericField = Exclude<
  keyof EffectSlotState,
  "enabled" | "type" | "nukeType" | "colors"
>;

// field, label, min, max, step
const NUMERIC_FIELDS: [NumericField, string, number, number, number][] = [
  ["colorSize", "Color Size (tiles)", 0.5, 40, 0.5],
  ["movementSpeed", "Movement (tiles/s)", -50, 50, 0.5],
  ["frequency", "Frequency (colors/s)", -10, 10, 0.1],
  ["radius", "Radius (tiles)", 1, 30, 0.5],
  ["strands", "Strands", 1, 8, 1],
  ["rotationSpeed", "Rotation (rad/s)", -20, 20, 0.1],
  ["size", "Size (tiles)", 10, 800, 5],
  ["speed", "Speed (tiles/s)", 5, 1000, 5],
  ["thickness", "Thickness (tiles)", 0.5, 40, 0.5],
  ["transitionSpeed", "Transition (colors/s)", -10, 10, 0.1],
  ["density", "Density", 2, 2000, 1],
];

export function createEffectGui(hooks: EffectGuiHooks): {
  open(): void;
  destroy(): void;
} {
  const gui = new GUI({ title: "Effect Editor", width: 320 });
  gui.domElement.style.position = "fixed";
  gui.domElement.style.top = "8px";
  // Beside the render debug GUI (which sits at right: 8px, width 320).
  gui.domElement.style.right = "340px";
  gui.domElement.style.zIndex = "100";
  makeDraggable(gui);

  const slots: { effectType: EffectType; state: EffectSlotState }[] = [];

  for (const effectType of EFFECT_TYPES) {
    const state = defaultSlotState(effectType);
    slots.push({ effectType, state });
    const folder = gui.addFolder(SLOT_LABELS[effectType]);
    const fieldCtrls: [keyof EffectSlotState, Controller][] = [];
    const colorCtrls: Controller[] = [];

    const apply = () => {
      const attrs = state.enabled ? slotAttributes(effectType, state) : null;
      if (state.enabled && !attrs) {
        console.warn(`Effect editor: ${effectType} attributes are invalid`);
      }
      hooks.setOverride(effectType, attrs);
    };
    const refresh = () => {
      const shown = fieldsForType(effectType, state.type);
      for (const [field, ctrl] of fieldCtrls) ctrl.show(shown.has(field));
      colorCtrls.forEach((ctrl, i) =>
        ctrl.show(shown.has("colors") && i < state.colorCount),
      );
    };

    folder.add(state, "enabled").name("Enabled").onChange(apply);
    folder
      .add(state, "type", [...EFFECT_GUI_TYPES[effectType]])
      .name("Type")
      .onChange(() => {
        refresh();
        apply();
      });
    if (effectType === "nukeExplosion") {
      fieldCtrls.push([
        "nukeType",
        folder
          .add(state, "nukeType", [...NUKE_EXPLOSION_TYPES])
          .name("Bomb")
          .onChange(apply),
      ]);
    }
    // Only the fields some type of this slot uses; refresh() hides the rest.
    const usable = new Set<keyof EffectSlotState>();
    for (const t of EFFECT_GUI_TYPES[effectType]) {
      for (const f of fieldsForType(effectType, t)) usable.add(f);
    }
    for (const [field, label, min, max, step] of NUMERIC_FIELDS) {
      if (!usable.has(field)) continue;
      fieldCtrls.push([
        field,
        folder.add(state, field, min, max, step).name(label).onChange(apply),
      ]);
    }
    fieldCtrls.push([
      "colorCount",
      folder
        .add(state, "colorCount", 0, EFFECT_GUI_MAX_COLORS, 1)
        .name("Colors")
        .onChange(() => {
          refresh();
          apply();
        }),
    ]);
    for (let i = 0; i < EFFECT_GUI_MAX_COLORS; i++) {
      colorCtrls.push(
        folder
          .addColor(
            state.colors as unknown as Record<string, string>,
            String(i),
          )
          .name(`Color ${i}`)
          .onChange(apply),
      );
    }
    folder
      .add(
        {
          copy: () => {
            const snippet = catalogSnippet(effectType, state);
            if (snippet) void copyToClipboard(snippet);
            else console.warn(`Effect editor: ${effectType} is invalid`);
          },
        },
        "copy",
      )
      .name("Copy catalog JSON");

    refresh();
    folder.close();
  }

  const disableAll = () => {
    for (const { effectType, state } of slots) {
      if (!state.enabled) continue;
      state.enabled = false;
      hooks.setOverride(effectType, null);
    }
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  };
  gui.add({ disableAll }, "disableAll").name("Disable All");

  return {
    open: () => gui.open(),
    destroy: () => {
      disableAll();
      gui.destroy();
    },
  };
}
