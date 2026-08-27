import GUI from "lil-gui";
import type { RenderSettings } from "../RenderSettings";
import { createRenderSettings } from "../RenderSettings";
import { buildEffectEditor, type EffectEditorHooks } from "./EffectEditor";
import { buildTree } from "./Layout";
import { walkTree } from "./Tree";
import { makeDraggable, wireActions, wireModifiedIndicators } from "./Wiring";

export type { EffectEditorHooks } from "./EffectEditor";

/**
 * The in-game debug panel: an "Effect Editor" folder (live cosmetic-effect
 * tuning on the local player's units) and a "Render Settings" folder that
 * live-edits `settings` in place.
 */
export function createDebugGui(
  settings: RenderSettings,
  effectHooks: EffectEditorHooks,
  resolveDefaults: () => RenderSettings = createRenderSettings,
  onSettingsChanged?: () => void,
): { open(): void; destroy(): void } {
  const gui = new GUI({ title: "Render Debug GUI", width: 320 });
  gui.domElement.style.position = "fixed";
  gui.domElement.style.top = "8px";
  gui.domElement.style.right = "8px";
  gui.domElement.style.zIndex = "100";

  makeDraggable(gui);

  const effects = gui.addFolder("Effect Editor");
  const disableEffects = buildEffectEditor(effects, effectHooks);
  effects.close();

  // Defaults include the user's graphics overrides so "Reset to Defaults"
  // (and the per-prop reset / modified indicators) restore the same settings
  // the renderer was built with — not bare defaults that drop the overrides.
  const render = gui.addFolder("Render Settings");
  const defaults = resolveDefaults();
  const props = walkTree(buildTree(settings, defaults), render);

  // Scoped to the render folder: the modified indicators map props to
  // controllers by index, which the effect editor's controllers would skew.
  wireActions(render, settings, props, resolveDefaults, onSettingsChanged);
  wireModifiedIndicators(render, props, onSettingsChanged);
  render.close();

  gui.close();
  return {
    open: () => gui.open(),
    destroy: () => {
      disableEffects();
      gui.destroy();
    },
  };
}
