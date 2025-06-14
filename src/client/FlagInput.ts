import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
const flagKey: string = "flag";

import frame from "../../resources/flags/custom/frame.svg";

import center_circle from "../../resources/flags/custom/center_circle.svg";
import center_flower from "../../resources/flags/custom/center_flower.svg";
import center_hline from "../../resources/flags/custom/center_hline.svg";
import center_star from "../../resources/flags/custom/center_star.svg";
import center_vline from "../../resources/flags/custom/center_vline.svg";
import diag_bl from "../../resources/flags/custom/diag_bl.svg";
import diag_br from "../../resources/flags/custom/diag_br.svg";
import eu_star from "../../resources/flags/custom/eu_star.svg";
import flower_tc from "../../resources/flags/custom/flower_tc.svg";
import flower_tl from "../../resources/flags/custom/flower_tl.svg";
import flower_tr from "../../resources/flags/custom/flower_tr.svg";
import full from "../../resources/flags/custom/full.svg";
import half_b from "../../resources/flags/custom/half_b.svg";
import half_l from "../../resources/flags/custom/half_l.svg";
import half_r from "../../resources/flags/custom/half_r.svg";
import half_t from "../../resources/flags/custom/half_t.svg";
import laurel_wreath from "../../resources/flags/custom/laurel_wreath.svg";
import mini_tr_bl from "../../resources/flags/custom/mini_tr_bl.svg";
import mini_tr_br from "../../resources/flags/custom/mini_tr_br.svg";
import mini_tr_tl from "../../resources/flags/custom/mini_tr_tl.svg";
import mini_tr_tr from "../../resources/flags/custom/mini_tr_tr.svg";
import nato_emblem from "../../resources/flags/custom/nato_emblem.svg";
import octagram from "../../resources/flags/custom/octagram.svg";
import octagram_2 from "../../resources/flags/custom/octagram_2.svg";
import ofm_2025 from "../../resources/flags/custom/ofm_2025.svg";
import triangle_b from "../../resources/flags/custom/triangle_b.svg";
import triangle_bl from "../../resources/flags/custom/triangle_bl.svg";
import triangle_br from "../../resources/flags/custom/triangle_br.svg";
import triangle_l from "../../resources/flags/custom/triangle_l.svg";
import triangle_r from "../../resources/flags/custom/triangle_r.svg";
import triangle_t from "../../resources/flags/custom/triangle_t.svg";
import triangle_tl from "../../resources/flags/custom/triangle_tl.svg";
import triangle_tr from "../../resources/flags/custom/triangle_tr.svg";
import tricolor_b from "../../resources/flags/custom/tricolor_b.svg";
import tricolor_c from "../../resources/flags/custom/tricolor_c.svg";
import tricolor_l from "../../resources/flags/custom/tricolor_l.svg";
import tricolor_m from "../../resources/flags/custom/tricolor_m.svg";
import tricolor_r from "../../resources/flags/custom/tricolor_r.svg";
import tricolor_t from "../../resources/flags/custom/tricolor_t.svg";

import rocket from "../../resources/flags/custom/rocket.svg";
import rocket_mini from "../../resources/flags/custom/rocket_mini.svg";

import og from "../../resources/flags/custom/og.svg";
import og_plus from "../../resources/flags/custom/og_plus.svg";

import translator from "../../resources/flags/custom/translator.svg";

import beta_tester from "../../resources/flags/custom/beta_tester.svg";
import beta_tester_circle from "../../resources/flags/custom/beta_tester_circle.svg";

import admin_contributors from "../../resources/flags/custom/admin_contributors.svg";
import admin_shield from "../../resources/flags/custom/admin_shield.svg";
import admin_shield_r from "../../resources/flags/custom/admin_shield_r.svg";

import admin_evan from "../../resources/flags/custom/admin_evan.svg";

export const FlagMap: Record<string, string> = {
  frame,
  center_hline,
  center_vline,
  diag_br,
  diag_bl,
  triangle_tl,
  triangle_tr,
  triangle_bl,
  triangle_br,
  half_l,
  half_r,
  half_t,
  half_b,
  mini_tr_tl,
  mini_tr_tr,
  mini_tr_bl,
  mini_tr_br,
  triangle_t,
  triangle_l,
  triangle_b,
  triangle_r,
  tricolor_l,
  tricolor_c,
  tricolor_r,
  tricolor_t,
  tricolor_m,
  tricolor_b,
  center_circle,
  center_star,
  center_flower,
  flower_tl,
  flower_tc,
  flower_tr,
  nato_emblem,
  eu_star,
  laurel_wreath,
  octagram,
  octagram_2,
  ofm_2025,
  beta_tester,
  beta_tester_circle,
  rocket,
  rocket_mini,
  admin_contributors,
  translator,
  og,
  og_plus,
  admin_shield,
  admin_shield_r,
  admin_evan,
  full,
};

type FlagLayer = {
  name: string;
  show: boolean;
  shortName?: string;
  free?: boolean;
  roles?: string[];
  rank?: number;
};
const flagLayers = {
  frame: {
    name: frame,
    show: false,
    shortName: "k",
    free: true,
  },
  center_hline: {
    name: center_hline,
    show: false,
    shortName: "b",
    free: true,
  },
} as const satisfies Record<string, FlagLayer>;

export const LayerShortNames: Record<string, string> = {
  center_circle: "a",
  center_hline: "b",
  center_vline: "c",
  center_star: "d",
  center_flower: "e",
  flower_tl: "f",
  flower_tc: "g",
  flower_tr: "h",
  diag_br: "i",
  diag_bl: "j",
  frame: "k",
  full: "l",
  triangle_tl: "m",
  triangle_bl: "n",
  triangle_tr: "o",
  triangle_br: "p",
  half_l: "q",
  half_r: "r",
  half_t: "s",
  half_b: "t",
  mini_tr_bl: "u",
  mini_tr_br: "v",
  mini_tr_tl: "w",
  mini_tr_tr: "x",
  triangle_t: "y",
  triangle_l: "z",
  triangle_b: "aa",
  triangle_r: "ab",
  tricolor_l: "ac",
  tricolor_c: "ad",
  tricolor_r: "ae",
  tricolor_t: "af",
  tricolor_m: "ag",
  tricolor_b: "ah",
  nato_emblem: "ai",
  eu_star: "aj",
  laurel_wreath: "ak",
  ofm_2025: "al",
  octagram: "am",
  octagram_2: "an",
  og: "ao",
  og_plus: "ap",
  beta_tester: "aq",
  beta_tester_circle: "ar",
  rocket: "as",
  rocket_mini: "at",
  translator: "au",
  admin_shield: "av",
  admin_shield_r: "aw",
  admin_evan: "ax",
};

export const ColorShortNames: Record<string, string> = {
  "#ff0000": "a", // red
  "#ffa500": "b", // orange
  "#ffff00": "c", // yellow
  "#008000": "d", // green
  "#00ffff": "e", // cyan
  "#0000ff": "f", // blue
  "#000000": "g", // black
  "#ffffff": "h", // white
  "#800080": "i", // purple
  "#ff69b4": "j", // hotpink
  "#a52a2a": "k", // brown
  "#808080": "l", // gray
  "#20b2aa": "m", // teal
  "#ff6347": "n", // tomato
  "#4682b4": "o", // steelblue
  "#90ee90": "p", // lightgreen
  "#8b0000": "q", // darkred
  "#191970": "r", // navy
  "#ffd700": "s", // gold
  "#add8e6": "t", // lightblue
  "#f5f5dc": "u", // beige
  "#ffb6c1": "v", // lightpink
  "#708090": "w", // slategray
  "#00ff7f": "x", // springgreen
  "#dc143c": "y", // crimson
  "#ffbf00": "z", // amber
  "#3d9970": "0", // olive green
  "#87ceeb": "1", // sky blue
  "#6a5acd": "2", // slate blue
  "#ff66cc": "3", // rose pink
  "#36454f": "4", // charcoal
  "#fffff0": "5", // ivory

  rainbow: "A", // dark rainbow animation
  "bright-rainbow": "B", // bright rainbow animation
  "gold-glow": "C", // glowing gold animation
  "silver-glow": "D", // glowing silver animation
  "copper-glow": "E", // glowing copper animation
  neon: "F", // neon green pulse animation
  lava: "G", // lava animation
  water: "H", // soft blue breathing animation
};

export const userStatus = {
  // debug
  isDebug_: true,

  // discord
  isEvan: false,
  isAdmin: false,
  isOg: false,
  isOg100: false,
  isSupporters: false,
  isBetaTester: false,
  isContributors: false,
  isTranslator: false,
  isWellKnownPlayer: false,
  isKnownPlayer: false,
  isSeenplayer: false,
  isLoginPlayer: false,

  // event
  ofm_2025_event: false,
};

export type UserStatus = {
  // debug
  isDebug_: boolean;

  // discord
  isEvan: boolean;
  isAdmin: boolean;
  isOg: boolean;
  isOg100: boolean;
  isSupporters: boolean;
  isBetaTester: boolean;
  isContributors: boolean;
  isTranslator: boolean;
  isWellKnownPlayer: boolean;
  isKnownPlayer: boolean;
  isSeenplayer: boolean;
  isLoginPlayer: boolean;

  // event
  ofm_2025_event: boolean;
};

export let MAX_LAYER = 50;

type LockReasonMap = Record<string, string>;

export function checkPermission(): [string[], string[], LockReasonMap, number] {
  const lockedLayers_: string[] = [];
  const lockedColors_: string[] = [];
  const lockedReasons_: LockReasonMap = {};

  MAX_LAYER = 50;

  const lock = (list: string[], reasonKey: string) => {
    const reason = translateText(reasonKey);
    for (const item of list) {
      lockedLayers_.push(item);
      lockedReasons_[item] = reason;
    }
  };

  const lockColor = (list: string[], reasonKey: string) => {
    const reason = translateText(reasonKey);
    for (const color of list) {
      lockedColors_.push(color);
      lockedReasons_[color] = reason;
    }
  };

  if (userStatus.isEvan || userStatus.isDebug_) {
    MAX_LAYER = 50;
    return [lockedLayers_, lockedColors_, lockedReasons_, MAX_LAYER];
  }

  lock(["admin_evan"], "flag_input.reason.admin_evan");

  if (!userStatus.isAdmin) {
    lock(["admin_shield", "admin_shield_r"], "flag_input.reason.admin");
  }

  if (userStatus.isAdmin) {
    MAX_LAYER = 45;
  } else if (userStatus.isContributors || userStatus.isSupporters) {
    MAX_LAYER = 40;
  } else if (
    userStatus.isOg ||
    userStatus.isOg100 ||
    userStatus.isTranslator ||
    userStatus.isBetaTester
  ) {
    MAX_LAYER = 35;
  } else if (userStatus.isWellKnownPlayer) {
    MAX_LAYER = 20;
  } else if (userStatus.isKnownPlayer) {
    MAX_LAYER = 15;
  } else if (userStatus.isSeenplayer) {
    MAX_LAYER = 10;
  } else if (userStatus.isLoginPlayer) {
    MAX_LAYER = 5;
  } else {
    MAX_LAYER = 3;
  }

  if (!userStatus.isContributors) {
    lock(["admin_contributors"], "flag_input.reason.contributors");
  }

  if (!userStatus.isBetaTester) {
    lock(["beta_tester", "beta_tester_circle"], "flag_input.reason.beta");
  }

  if (!userStatus.ofm_2025_event) {
    lock(["ofm_2025"], "flag_input.reason.ofm_2025");
  }

  if (!userStatus.isSupporters) {
    lock(["rocket_mini", "rocket"], "flag_input.reason.supporters");
    lockColor(
      [
        "rainbow",
        "bright-rainbow",
        "gold-glow",
        "silver-glow",
        "copper-glow",
        "neon",
        "lava",
        "water",
      ],
      "flag_input.reason.supporters",
    );
  } else {
    return [lockedLayers_, lockedColors_, lockedReasons_, MAX_LAYER];
  }

  if (!userStatus.isOg) {
    lock(["og_plus"], "flag_input.reason.og");
  }

  if (!userStatus.isOg100) {
    lock(["og"], "flag_input.reason.og100");
  }

  if (!userStatus.isTranslator) {
    lock(["translator"], "flag_input.reason.translator");
  }

  if (!userStatus.isWellKnownPlayer) {
    lock(
      [
        "center_circle",
        "center_star",
        "center_flower",
        "flower_tc",
        "flower_tl",
        "flower_tr",
        "nato_emblem",
        "eu_star",
        "laurel_wreath",
        "octagram",
        "octagram_2",
      ],
      "flag_input.reason.well_known",
    );
    lockColor(
      [
        "#ffd700",
        "#add8e6",
        "#f5f5dc",
        "#ffb6c1",
        "#708090",
        "#00ff7f",
        "#dc143c",
        "#ffbf00",
        "#3d9970",
        "#87ceeb",
        "#6a5acd",
        "#ff66cc",
        "#36454f",
        "#fffff0",
      ],
      "flag_input.reason.well_known",
    );

    if (!userStatus.isKnownPlayer) {
      lock(
        [
          "tricolor_b",
          "tricolor_c",
          "tricolor_l",
          "tricolor_m",
          "tricolor_r",
          "tricolor_t",
          "triangle_t",
          "triangle_l",
          "triangle_b",
          "triangle_r",
          "mini_tr_tr",
          "mini_tr_tl",
          "mini_tr_br",
          "mini_tr_bl",
        ],
        "flag_input.reason.known",
      );
      lockColor(
        [
          "#800080",
          "#ff69b4",
          "#a52a2a",
          "#808080",
          "#20b2aa",
          "#ff6347",
          "#4682b4",
          "#90ee90",
          "#8b0000",
          "#191970",
        ],
        "flag_input.reason.known",
      );

      if (!userStatus.isSeenplayer) {
        lock(
          ["half_l", "half_r", "half_b", "half_t"],
          "flag_input.reason.seen",
        );
        lockColor(["#ffa500", "#00ffff"], "flag_input.reason.seen");

        if (!userStatus.isLoginPlayer) {
          lock(
            ["triangle_br", "triangle_bl", "triangle_tr", "triangle_tl"],
            "flag_input.reason.login",
          );
          lockColor(["#ffff00", "#008000"], "flag_input.reason.login");
        }
      }
    }
  }

  return [lockedLayers_, lockedColors_, lockedReasons_, MAX_LAYER];
}

@customElement("flag-input")
export class FlagInput extends LitElement {
  @state() public flag: string = "";

  static styles = css`
    @media (max-width: 768px) {
      .flag-modal {
        width: 80vw;
      }

      .dropdown-item {
        width: calc(100% / 3 - 15px);
      }
    }
  `;

  public getCurrentFlag(): string {
    return this.flag;
  }

  private getStoredFlag(): string {
    const storedFlag = localStorage.getItem(flagKey);
    if (storedFlag) {
      return storedFlag;
    }
    return "";
  }

  private dispatchFlagEvent() {
    this.dispatchEvent(
      new CustomEvent("flag-change", {
        detail: { flag: this.flag },
        bubbles: true,
        composed: true,
      }),
    );
  }

  connectedCallback() {
    super.connectedCallback();
    this.flag = this.getStoredFlag();
    this.dispatchFlagEvent();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="flex relative">
        <button
          id="flag-input_"
          class="border p-[4px] rounded-lg flex cursor-pointer border-black/30 dark:border-gray-300/60 bg-white/70 dark:bg-[rgba(55,65,81,0.7)]"
          title="Pick a flag!"
        >
          ${this.renderFlagPreview(this.flag)}
        </button>
      </div>
    `;
  }

  private isCustomFlag(flag: string): boolean {
    return flag.startsWith("ctmfg");
  }

  private decodeCustomFlag(code: string): { name: string; color: string }[] {
    if (!this.isCustomFlag(code)) return [];

    const short = code.slice("ctmfg".length);
    const reverseNameMap = Object.fromEntries(
      Object.entries(LayerShortNames).map(([k, v]) => [v, k]),
    );
    const reverseColorMap = Object.fromEntries(
      Object.entries(ColorShortNames).map(([k, v]) => [v, k]),
    );

    return short.split("_").map((segment) => {
      const [shortName, shortColor] = segment.split("-");
      const name = reverseNameMap[shortName] || shortName;
      const color = reverseColorMap[shortColor] || `#${shortColor}`;
      return { name, color };
    });
  }

  private renderFlagPreview(flag: string) {
    if (!this.isCustomFlag(flag)) {
      return html`<img class="size-[48px]" src="/flags/${flag || "xx"}.svg" />`;
    }

    const layers = this.decodeCustomFlag(flag);
    return html`
      <div
        class="size-[48px] relative border border-gray-300 rounded overflow-hidden bg-white"
      >
        ${layers.map(({ name, color }) => {
          const src = FlagMap[name];
          if (!src) return null;

          const isSpecial = !color.startsWith("#");
          const colorClass = isSpecial ? `flag-color-${color}` : "";
          const bgStyle = isSpecial ? "" : `background-color: ${color};`;

          return html`
            <div
              class="absolute top-0 left-0 w-full h-full ${colorClass}"
              style="
                ${bgStyle}
                -webkit-mask: url(${src}) center / contain no-repeat;
                mask: url(${src}) center / contain no-repeat;
              "
            ></div>
          `;
        })}
      </div>
    `;
  }
}

const animationDurations: Record<string, number> = {
  rainbow: 4000,
  "bright-rainbow": 4000,
  "copper-glow": 3000,
  "silver-glow": 3000,
  "gold-glow": 3000,
  neon: 3000,
  lava: 6000,
  water: 6200,
};

export function renderPlayerFlag(flagCode: string, target: HTMLElement) {
  const reverseNameMap = Object.fromEntries(
    Object.entries(LayerShortNames).map(([k, v]) => [v, k]),
  );

  const reverseColorMap = Object.fromEntries(
    Object.entries(ColorShortNames).map(([k, v]) => [v, k]),
  );

  if (!flagCode.startsWith("ctmfg")) return;

  const code = flagCode.slice("ctmfg".length);
  const layers = code.split("_").map((segment) => {
    const [shortName, shortColor] = segment.split("-");
    const name = reverseNameMap[shortName] || shortName;
    const color = reverseColorMap[shortColor] || shortColor;
    return { name, color };
  });

  target.innerHTML = "";
  target.style.overflow = "hidden";
  target.style.position = "relative";
  target.style.aspectRatio = "3/4";

  for (const { name, color } of layers) {
    const mask = `/flags/custom/${name}.svg`;
    if (!mask) continue;

    const layer = document.createElement("div");
    layer.style.position = "absolute";
    layer.style.top = "0";
    layer.style.left = "0";
    layer.style.width = "100%";
    layer.style.height = "100%";

    const isSpecial = !color.startsWith("#");

    if (isSpecial) {
      const duration = animationDurations[color] ?? 5000;
      const now = performance.now();
      const offset = now % duration;
      if (!duration) console.warn(`No animation duration for: ${color}`);
      layer.classList.add(`flag-color-${color}`);
      layer.style.animationDelay = `-${offset}ms`;
    } else {
      layer.style.backgroundColor = color;
    }

    layer.style.maskImage = `url(${mask})`;
    layer.style.maskRepeat = "no-repeat";
    layer.style.maskPosition = "center";
    layer.style.maskSize = "contain";

    layer.style.webkitMaskImage = `url(${mask})`;
    layer.style.webkitMaskRepeat = "no-repeat";
    layer.style.webkitMaskPosition = "center";
    layer.style.webkitMaskSize = "contain";

    target.appendChild(layer);
  }
}

export function analyzePlayerFlag(flagCode: string): {
  colors: string[];
  layers: string[];
  count: number;
} {
  if (!flagCode.startsWith("ctmfg"))
    return { colors: [], layers: [], count: 0 };

  const reverseNameMap = Object.fromEntries(
    Object.entries(LayerShortNames).map(([k, v]) => [v, k]),
  );

  const reverseColorMap = Object.fromEntries(
    Object.entries(ColorShortNames).map(([k, v]) => [v, k]),
  );

  const code = flagCode.slice("ctmfg".length);
  const segments = code.split("_");

  const layers: string[] = [];
  const colors: string[] = [];

  for (const segment of segments) {
    const [shortName, shortColor] = segment.split("-");
    const name = reverseNameMap[shortName] || shortName;
    const color = reverseColorMap[shortColor] || shortColor;

    layers.push(name);
    colors.push(color);
  }

  return {
    colors,
    layers,
    count: layers.length,
  };
}
