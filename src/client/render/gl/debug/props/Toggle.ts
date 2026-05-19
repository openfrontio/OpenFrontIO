import type GUI from "lil-gui";
import type { Controller } from "lil-gui";
import type { ConfigProp } from "../ConfigProp";

export function toggle<T extends Record<string, unknown>>(
  target: T,
  key: keyof T & string,
  defaults: T,
  label?: string,
): ConfigProp {
  const defaultVal = defaults[key] as boolean;
  let ctrl: Controller | undefined;
  return {
    draw(folder: GUI) {
      ctrl = folder.add(target, key);
      if (label) ctrl.name(label);
      return ctrl;
    },
    isModified: () => (target[key] as boolean) !== defaultVal,
    resetToDefault() {
      (target as Record<string, unknown>)[key] = defaultVal;
      ctrl?.updateDisplay();
    },
    updateDisplay() {
      ctrl?.updateDisplay();
    },
  };
}
