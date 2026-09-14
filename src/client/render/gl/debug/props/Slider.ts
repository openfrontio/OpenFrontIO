import type GUI from "lil-gui";
import type { Controller } from "lil-gui";
import type { ConfigProp } from "../ConfigProp";

export function slider<T extends Record<string, unknown>>(
  target: T,
  key: keyof T & string,
  defaults: T,
  min: number,
  max: number,
  step: number,
  label?: string,
): ConfigProp {
  const defaultVal = defaults[key] as number;
  let ctrl: Controller | undefined;
  return {
    draw(folder: GUI) {
      ctrl = folder.add(target, key, min, max, step);
      if (label) ctrl.name(label);
      return ctrl;
    },
    isModified: () => (target[key] as number) !== defaultVal,
    resetToDefault() {
      (target as Record<string, unknown>)[key] = defaultVal;
      ctrl?.updateDisplay();
    },
    updateDisplay() {
      ctrl?.updateDisplay();
    },
  };
}
