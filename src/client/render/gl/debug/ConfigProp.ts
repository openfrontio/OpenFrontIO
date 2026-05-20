import type { Controller } from "lil-gui";

/**
 * A single configurable property in the debug GUI.
 * Each prop knows how to draw itself, report modification, and reset.
 */
export interface ConfigProp {
  draw(folder: import("lil-gui").default): Controller;
  isModified(): boolean;
  resetToDefault(): void;
  updateDisplay(): void;
}
