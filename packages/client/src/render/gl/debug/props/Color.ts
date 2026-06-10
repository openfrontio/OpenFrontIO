import type GUI from "lil-gui";
import type { ColorController, Controller } from "lil-gui";
import type { ConfigProp } from "../ConfigProp";

export function color<T extends Record<string, unknown>>(
  target: T,
  rKey: keyof T & string,
  gKey: keyof T & string,
  bKey: keyof T & string,
  defaults: T,
  label?: string,
): ConfigProp {
  const defaultR = defaults[rKey] as number;
  const defaultG = defaults[gKey] as number;
  const defaultB = defaults[bKey] as number;

  const proxy = {
    color: {
      r: target[rKey] as number,
      g: target[gKey] as number,
      b: target[bKey] as number,
    },
  };
  let ctrl: Controller | undefined;

  return {
    draw(folder: GUI) {
      ctrl = folder
        .addColor(proxy, "color")
        .onChange((v: { r: number; g: number; b: number }) => {
          (target as Record<string, unknown>)[rKey] = v.r;
          (target as Record<string, unknown>)[gKey] = v.g;
          (target as Record<string, unknown>)[bKey] = v.b;
        });
      if (label) ctrl.name(label);
      return ctrl;
    },
    isModified: () =>
      (target[rKey] as number) !== defaultR ||
      (target[gKey] as number) !== defaultG ||
      (target[bKey] as number) !== defaultB,
    resetToDefault() {
      (target as Record<string, unknown>)[rKey] = defaultR;
      (target as Record<string, unknown>)[gKey] = defaultG;
      (target as Record<string, unknown>)[bKey] = defaultB;
      proxy.color = { r: defaultR, g: defaultG, b: defaultB };
      (ctrl as ColorController | undefined)?.load(
        "#" +
          [defaultR, defaultG, defaultB]
            .map((v) =>
              Math.round(v * 255)
                .toString(16)
                .padStart(2, "0"),
            )
            .join(""),
      );
    },
    updateDisplay() {
      proxy.color = {
        r: target[rKey] as number,
        g: target[gKey] as number,
        b: target[bKey] as number,
      };
      ctrl?.updateDisplay();
    },
  };
}
