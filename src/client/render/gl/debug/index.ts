import GUI from "lil-gui";
import type { RenderSettings } from "../render-settings";
import { createRenderSettings } from "../render-settings";
import { buildTree } from "./layout";
import { walkTree } from "./tree";
import { makeDraggable, wireActions, wireModifiedIndicators } from "./wiring";

export function createDebugGui(
  settings: RenderSettings,
  onSettingsChanged?: () => void,
): GUI {
  const gui = new GUI({ title: "Render Settings", width: 320 });
  gui.domElement.style.position = "fixed";
  gui.domElement.style.top = "8px";
  gui.domElement.style.right = "8px";
  gui.domElement.style.zIndex = "100";

  makeDraggable(gui);

  const defaults = createRenderSettings();
  const props = walkTree(buildTree(settings, defaults), gui);

  wireActions(gui, settings, props, onSettingsChanged);
  wireModifiedIndicators(gui, props, onSettingsChanged);

  gui.close();
  return gui;
}
