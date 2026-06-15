import GUI from "lil-gui";
import type { RenderSettings } from "../RenderSettings";
import { createRenderSettings } from "../RenderSettings";
import { buildTree } from "./Layout";
import { walkTree } from "./Tree";
import { makeDraggable, wireActions, wireModifiedIndicators } from "./Wiring";

export function createDebugGui(
  settings: RenderSettings,
  resolveDefaults: () => RenderSettings = createRenderSettings,
  onSettingsChanged?: () => void,
): GUI {
  const gui = new GUI({ title: "Render Settings", width: 320 });
  gui.domElement.style.position = "fixed";
  gui.domElement.style.top = "8px";
  gui.domElement.style.right = "8px";
  gui.domElement.style.zIndex = "100";

  makeDraggable(gui);

  // Defaults include the user's graphics overrides so "Reset to Defaults"
  // (and the per-prop reset / modified indicators) restore the same settings
  // the renderer was built with — not bare defaults that drop the overrides.
  const defaults = resolveDefaults();
  const props = walkTree(buildTree(settings, defaults), gui);

  wireActions(gui, settings, props, resolveDefaults, onSettingsChanged);
  wireModifiedIndicators(gui, props, onSettingsChanged);

  gui.close();
  return gui;
}
