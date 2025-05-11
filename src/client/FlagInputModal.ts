import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import Countries from "./data/countries.json";
import {
  ColorShortNames,
  FlagMap,
  LayerShortNames,
  MAX_LAYER,
  checkPermission,
} from "./FlagInput";

import { FlagInput } from "./FlagInput";

import disabled from "../../resources/images/DisabledIcon.svg";
import locked from "../../resources/images/Locked.svg";

const flagKey: string = "flag";

@customElement("flag-input-modal")
export class FlagInputModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  createRenderRoot() {
    return this;
  }

  @state() private flag: string = "";
  @state() private errorMessage: string = "";
  @state() private search: string = "";
  @state() private showModal: boolean = false;
  @state() private activeTab: "real" | "custom" = "real";
  @state() private selectedColor: string = "#ff0000";
  @state() private openColorIndex: number | null = null;

  private readonly colorOptions: string[] = Object.keys(ColorShortNames);

  @state() private customLayers: { name: string; color: string }[] = [];

  @state() private hoveredColor: string | null = null;
  @state() private hoverPosition = { x: 0, y: 0 };
  @state() private hoverReason: string | null = null;

  private addLayer(name: string) {
    const totalLayers = this.customLayers.length;

    if (totalLayers >= MAX_LAYER) {
      alert(`You can only add up to ${MAX_LAYER} layers.`);
      return;
    }

    const newLayer = { name, color: this.selectedColor };
    this.customLayers = [
      this.customLayers[0],
      newLayer,
      ...this.customLayers.slice(1),
    ];
  }

  private removeLayer(index: number) {
    this.customLayers = this.customLayers.filter((_, i) => i !== index);
  }

  private moveLayerUp(index: number) {
    if (index === 0) return;
    const newLayers = [...this.customLayers];
    [newLayers[index - 1], newLayers[index]] = [
      newLayers[index],
      newLayers[index - 1],
    ];
    this.customLayers = newLayers;
  }

  private moveLayerDown(index: number) {
    if (index === this.customLayers.length - 1) return;
    const newLayers = [...this.customLayers];
    [newLayers[index], newLayers[index + 1]] = [
      newLayers[index + 1],
      newLayers[index],
    ];
    this.customLayers = newLayers;
  }

  private updateLayerColor(index: number, color: string) {
    const newLayers = [...this.customLayers];
    newLayers[index].color = color;
    this.customLayers = newLayers;
  }

  private toggleColorPicker(index: number) {
    this.openColorIndex = this.openColorIndex === index ? null : index;
  }

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

  private handleSearch(e: Event) {
    this.search = String((e.target as HTMLInputElement).value);
  }

  private setFlag(flag: string) {
    if (flag == "xx") {
      flag = "";
    }
    this.flag = flag;
    this.showModal = false;
    this.storeFlag(flag);
    const el = document.querySelector("flag-input") as FlagInput;
    el.flag = this.flag;
    el.requestUpdate();
  }

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

  private storeFlag(flag: string) {
    if (flag) {
      localStorage.setItem(flagKey, flag);
    } else if (flag === "") {
      localStorage.removeItem(flagKey);
    }
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

    if (this.isCustomFlag(this.flag)) {
      this.customLayers = this.decodeCustomFlag(this.flag);
    } else {
      if (this.customLayers.length === 0) {
        this.customLayers = [
          { name: "full", color: "#ffffff" },
          { name: "frame", color: "#000000" },
        ];
      }
    }
  }

  private lockedLayers: string[] = [];

  private lockedColors: string[] = [];

  private lockedReasons: Record<string, string> = {};

  private encodeCustomFlag(): string {
    return (
      "ctmfg" +
      this.customLayers
        .map(({ name, color }) => {
          const shortName = LayerShortNames[name] || name;
          const shortColor = ColorShortNames[color] || color.replace("#", "");
          return `${shortName}-${shortColor}`;
        })
        .join("_")
    );
  }

  private isCustomFlag(flag: string): boolean {
    return flag.startsWith("ctmfg");
  }

  private decodeCustomFlag(code: string): { name: string; color: string }[] {
    if (!this.isCustomFlag(code)) return [];

    const short = code.replace("ctmfg", "");
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

  render() {
    const result = checkPermission();
    this.lockedLayers = Array.isArray(result[0]) ? result[0] : [result[0]];
    this.lockedColors = Array.isArray(result[1]) ? result[1] : [result[1]];
    this.lockedReasons = result[2] || {};
    return html`
      ${this.hoveredColor && this.lockedReasons[this.hoveredColor]
        ? html`
            <div
              class="fixed z-[9999] px-3 py-2 rounded bg-black text-white text-sm pointer-events-none shadow-md"
              style="top: ${this.hoverPosition.y + 12}px; left: ${this
                .hoverPosition.x + 12}px;"
            >
              ${this.lockedReasons[this.hoveredColor]}
            </div>
          `
        : null}
      <o-modal
        id="flaginputModal"
        title="Flag Input"
        translationKey="flag_input.title"
      >
        <!-- tab  -->
        <div class="flex gap-2 mb-2">
          <button
            class="px-4 py-1 rounded-lg font-bold ${this.activeTab === "real"
              ? "bg-blue-500 text-white"
              : "bg-gray-300 text-black"}"
            @click=${() => (this.activeTab = "real")}
          >
            ${translateText(`flag_input.real`)}
          </button>
          <button
            class="px-4 py-1 rounded-lg font-bold ${this.activeTab === "custom"
              ? "bg-blue-500 text-white"
              : "bg-gray-300 text-black"}"
            @click=${() => (this.activeTab = "custom")}
          >
            ${translateText(`flag_input.custom`)}
          </button>
        </div>

        ${this.activeTab === "real"
          ? html`
              <input
                class="h-[2rem] border-none text-center border border-gray-300 rounded-xl shadow-sm text-2xl text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black dark:border-gray-300/60 dark:bg-gray-700 dark:text-white"
                type="text"
                placeholder="Search..."
                @change=${this.handleSearch}
                @keyup=${this.handleSearch}
              />
              <div
                class="flex flex-wrap justify-evenly gap-[1rem] overflow-y-auto overflow-x-hidden"
              >
                ${Countries.filter(
                  (country) =>
                    country.name
                      .toLowerCase()
                      .includes(this.search.toLowerCase()) ||
                    country.code
                      .toLowerCase()
                      .includes(this.search.toLowerCase()),
                ).map(
                  (country) => html`
                    <button
                      @click=${() => {
                        this.setFlag(country.code);
                        this.close();
                      }}
                      class="text-center cursor-pointer border-none bg-none opacity-70 
                        w-[calc(100%/2-15px)] sm:w-[calc(100%/3-15px)] 
                        md:w-[calc(100%/4-15px)] lg:w-[calc(100%/5-15px)] 
                        xl:w-[calc(100%/6-15px)]"
                    >
                      <img
                        class="country-flag w-full h-auto"
                        src="/flags/${country.code}.svg"
                      />
                      <span class="country-name">${country.name}</span>
                    </button>
                  `,
                )}
              </div>
            `
          : html`
              <div class="grid grid-cols-[1fr_2fr] gap-4 p-2 h-full">
                <!-- left -->
                <div
                  class="flex flex-col items-center gap-2 overflow-y-auto max-h-[calc(50vh-4rem)]"
                >
                  <div class="flex flex-wrap gap-1 mb-2 justify-center">
                    ${this.colorOptions.map((color) => {
                      const isLocked = this.lockedColors.includes(color);
                      const isSpecial = !color.startsWith("#");
                      const colorClass = isSpecial ? `flag-color-${color}` : "";
                      const inlineStyle = isSpecial
                        ? ""
                        : `background-color: ${color};`;
                      const isSelected = this.selectedColor === color;
                      return html`
                        <button
                          class="w-4 h-4 rounded-full border-2 relative
${isSelected ? "border-white" : "border-gray-400"}
${isLocked ? "opacity-40 cursor-not-allowed" : ""}
${colorClass}"
                          style=${inlineStyle}
                          @click=${() =>
                            !isLocked && (this.selectedColor = color)}
                          @mouseenter=${(e: MouseEvent) => {
                            if (isLocked) {
                              this.hoveredColor = color;
                            }
                          }}
                          @mousemove=${(e: MouseEvent) => {
                            if (isLocked) {
                              this.hoverPosition = {
                                x: e.clientX,
                                y: e.clientY,
                              };
                            }
                          }}
                          @mouseleave=${() => {
                            this.hoveredColor = null;
                          }}
                          title=${color}
                        >
                          ${isLocked
                            ? html`<img
                                src=${locked}
                                alt="Locked"
                                class="absolute top-1/2 left-1/2 w-5 h-5 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                              />`
                            : ""}
                        </button>
                      `;
                    })}
                  </div>

                  <p class="text-lg font-bold text-white self-start">
                    ${translateText(`flag_input.select_layer`)}
                  </p>

                  ${this.customLayers.length >= MAX_LAYER
                    ? html`
                        <p class="text-sm text-red-400 self-start -mt-1 mb-2">
                          ${translateText("flag_input.max_layer_reached_1")}<br />
                          ${translateText("flag_input.max_layer_reached_2")}
                        </p>
                      `
                    : null}

                  <div
                    class="grid grid-cols-2 gap-2 w-full max-h-[300px] overflow-y-auto pr-1 mb-2"
                  >
                    ${Object.entries(FlagMap)
                      .filter(([name]) => name !== "frame" && name !== "full")
                      .map(([name, src]) => {
                        const isLocked = this.lockedLayers.includes(name);
                        const isDisabled =
                          !isLocked && this.customLayers.length >= MAX_LAYER;

                        const isSpecial = !this.selectedColor.startsWith("#");
                        const colorClass = isSpecial
                          ? `flag-color-${this.selectedColor}`
                          : "";
                        const colorStyle = isSpecial
                          ? ""
                          : `background-color: ${this.selectedColor};`;

                        const reason = isLocked
                          ? this.lockedReasons[name] || "Locked"
                          : isDisabled
                            ? `You can only add up to ${MAX_LAYER} layers.`
                            : "";

                        return html`
                          <button
                            @click=${() => {
                              if (!isLocked && !isDisabled) this.addLayer(name);
                            }}
                            class="p-1 border border-gray-600 rounded-md transition relative 
                          ${isLocked || isDisabled
                              ? "opacity-40 cursor-not-allowed"
                              : "hover:border-white"}"
                            ?disabled=${isLocked || isDisabled}
                            @mouseenter=${(e: MouseEvent) => {
                              if (reason) {
                                this.hoveredColor = name;
                                this.hoverReason = reason;
                                this.hoverPosition = {
                                  x: e.clientX,
                                  y: e.clientY,
                                };
                              }
                            }}
                            @mousemove=${(e: MouseEvent) => {
                              if (reason) {
                                this.hoverPosition = {
                                  x: e.clientX,
                                  y: e.clientY,
                                };
                              }
                            }}
                            @mouseleave=${() => {
                              this.hoveredColor = null;
                            }}
                          >
                            <div
                              class="w-full h-14 rounded relative"
                              title=${name}
                            >
                              <!-- black frame background -->
                              <div
                                class="absolute inset-0 rounded"
                                style="
                              background-color: black;
                              -webkit-mask: url(${FlagMap.frame}) center / contain no-repeat;
                              mask: url(${FlagMap.frame}) center / contain no-repeat;
                            "
                              ></div>

                              <!-- selected color mask -->
                              <div
                                class="absolute inset-0 rounded ${colorClass}"
                                style="
                              ${colorStyle}
                              -webkit-mask: url(${src}) center / contain no-repeat;
                              mask: url(${src}) center / contain no-repeat;
                            "
                              ></div>
                            </div>

                            ${isLocked
                              ? html`<img
                                  src=${locked}
                                  alt="Locked"
                                  class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 opacity-60 drop-shadow-md pointer-events-none"
                                />`
                              : isDisabled
                                ? html`<img
                                    src=${disabled}
                                    alt="Disabled"
                                    class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 opacity-60 drop-shadow-md pointer-events-none"
                                  />`
                                : null}
                          </button>
                        `;
                      })}
                  </div>
                </div>

                <!-- right -->
                <div
                  class="flex flex-col items-center h-full overflow-hidden max-h-[calc(50vh-4rem)]"
                >
                  <p class="text-lg font-bold text-white mb-2">
                    ${translateText(`flag_input.preview`)}
                  </p>
                  <div
                    class="relative w-[160px] h-[100px] min-w-[160px] min-h-[100px] max-w-[160px] max-h-[100px] flex-shrink-0 border border-gray-400 rounded bg-white"
                  >
                    ${this.customLayers.map(({ name, color }) => {
                      const src = FlagMap[name];
                      if (!src) return null;
                      console.log("color", color);
                      const isSpecial = !color.startsWith("#");
                      const colorClass = isSpecial ? `flag-color-${color}` : "";
                      const bgStyle = isSpecial
                        ? ""
                        : `background-color: ${color};`;

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

                  <button
                    @click=${() => {
                      const code = this.encodeCustomFlag();
                      navigator.clipboard.writeText(code);
                      console.log("Applied: " + code);
                      this.setFlag(code);
                      this.close();
                    }}
                    class="mt-2 px-4 py-1 bg-green-600 text-white rounded hover:bg-green-500"
                  >
                    ${translateText("flag_input.apply")}
                  </button>

                  <div class="mt-4 w-full max-h-[300px] overflow-y-auto mb-2">
                    <!-- Code input and copy -->
                    <div class="mt-2 w-full space-y-2">
                      ${this.errorMessage
                        ? html`
                            <div
                              class="p-2 bg-red-200 border border-red-500 text-red-800 rounded mb-2"
                            >
                              ${this.errorMessage}
                            </div>
                          `
                        : null}
                      <div class="grid grid-cols-2 gap-2 items-end">
                        <div>
                          <label class="text-white block mb-1"
                            >${translateText("flag_input.paste_code")}</label
                          >
                          <input
                            class="w-full p-1 border border-gray-500 rounded text-black ctmfg-input"
                            type="text"
                            placeholder=${translateText(
                              "flag_input.paste_ctmfg_placeholder",
                            )}
                          />
                        </div>
                        <div>
                          <button
                            @click=${() => {
                              const input = this.renderRoot.querySelector(
                                ".ctmfg-input",
                              ) as HTMLInputElement;
                              const val = input?.value?.trim();
                              if (!val?.startsWith("ctmfg")) {
                                this.errorMessage = translateText(
                                  "flag_input.error_invalid_code",
                                );
                                console.warn(
                                  "Rejected flag code not starting with 'ctmfg'.",
                                );
                                return;
                              }
                              if (!val || !this.isCustomFlag(val)) return;

                              const flagInfo = this.decodeCustomFlag(val);
                              const validLayerNames = Object.keys(FlagMap);
                              const validColorKeys = [
                                ...Object.keys(ColorShortNames),
                                ...Object.values(ColorShortNames),
                              ];
                              const hasUnknownLayer = flagInfo.some(
                                (l) => !validLayerNames.includes(l.name),
                              );
                              const hasUnknownColor = flagInfo.some(
                                (l) =>
                                  !validColorKeys.includes(l.color) &&
                                  !/^#[0-9a-fA-F]{6}$/.test(l.color),
                              );

                              if (hasUnknownLayer || hasUnknownColor) {
                                this.errorMessage = translateText(
                                  "flag_input.error_invalid_elements",
                                );
                                console.warn(
                                  "Blocked custom flag code due to invalid elements.",
                                );
                                return;
                              }

                              const result = checkPermission();
                              const lockedLayers = Array.isArray(result[0])
                                ? result[0]
                                : [result[0]];
                              const lockedColors = Array.isArray(result[1])
                                ? result[1]
                                : [result[1]];
                              const maxLayer = result[3];

                              const hasLockedLayer = flagInfo.some((l) =>
                                lockedLayers.includes(l.name),
                              );
                              const hasLockedColor = flagInfo.some((l) =>
                                lockedColors.includes(l.color),
                              );
                              const isLayerCountExceeded =
                                flagInfo.length > maxLayer;

                              if (
                                hasLockedLayer ||
                                hasLockedColor ||
                                isLayerCountExceeded
                              ) {
                                this.errorMessage = translateText(
                                  "flag_input.error_restricted_or_exceed",
                                );
                                console.warn(
                                  "Blocked custom flag code due to permissions.",
                                );
                                return;
                              }

                              this.errorMessage = "";
                              this.customLayers = flagInfo;
                              this.setFlag(val);
                            }}
                            class="w-full px-3 py-1 border border-gray-500 rounded text-white bg-green-700 hover:bg-green-600"
                          >
                            ${translateText("flag_input.apply_ctmfg_code")}
                          </button>
                        </div>
                      </div>
                      <div class="grid grid-cols-2 gap-2 items-end">
                        <div>
                          <label class="text-white block mb-1"
                            >${translateText("flag_input.current_code")}</label
                          >
                          <input
                            class="w-full p-1 border border-gray-500 rounded text-black"
                            type="text"
                            .value=${this.encodeCustomFlag()}
                            readonly
                          />
                        </div>
                        <div>
                          <button
                            @click=${() => {
                              const code = this.encodeCustomFlag();
                              navigator.clipboard.writeText(code);
                              console.log("Copied: " + code);
                            }}
                            class="w-full px-3 py-1 border border-gray-500 rounded text-white bg-gray-700 hover:bg-gray-600"
                          >
                            ${translateText("flag_input.copy_code")}
                          </button>
                        </div>
                      </div>
                    </div>

                    <p class="text-lg font-bold text-white mb-2">
                      ${translateText("flag_input.layer")}
                      (${this.customLayers.length})
                    </p>
                    <ul class="text-white space-y-1">
                      ${this.customLayers.map((_, i, arr) => {
                        const index = arr.length - 1 - i;
                        const { name, color } = arr[index];
                        const isFixed = name === "full" || name === "frame";

                        const isSpecial = !color.startsWith("#");
                        const colorClass = isSpecial
                          ? `flag-color-${color}`
                          : "";
                        const inlineStyle = isSpecial
                          ? ""
                          : `background-color: ${color};`;

                        return html`
                          <li
                            class="flex flex-col gap-1 py-1 px-2 bg-gray-800 rounded"
                          >
                            <div
                              class="flex flex-wrap justify-between items-center"
                            >
                              <span class="flex items-center gap-2">
                                <span
                                  class="inline-block w-4 h-4 rounded-full ${colorClass}"
                                  style=${inlineStyle}
                                ></span>
                                ${translateText(`flag_input.layers.${name}`)}
                                ${isFixed
                                  ? html`<span class="text-xs text-gray-400"
                                      >(${translateText(
                                        "flag_input.fixed",
                                      )})</span
                                    >`
                                  : ""}
                              </span>
                              <div class="flex gap-1">
                                ${!isFixed
                                  ? html`
                                      ${index > 1 &&
                                      this.customLayers[index - 1].name !==
                                        "full"
                                        ? html`
                                            <button
                                              @click=${() =>
                                                this.moveLayerUp(index)}
                                              title="Move Up"
                                              class="text-sm px-2 py-1 bg-gray-600 rounded hover:bg-gray-500"
                                            >
                                              ↓
                                            </button>
                                          `
                                        : ""}
                                      ${index < this.customLayers.length - 2 &&
                                      this.customLayers[index + 1].name !==
                                        "frame"
                                        ? html`
                                            <button
                                              @click=${() =>
                                                this.moveLayerDown(index)}
                                              title="Move Down"
                                              class="text-sm px-2 py-1 bg-gray-600 rounded hover:bg-gray-500"
                                            >
                                              ↑
                                            </button>
                                          `
                                        : ""}
                                      <button
                                        @click=${() => this.removeLayer(index)}
                                        class="text-red-400 hover:text-red-600"
                                      >
                                        ${translateText("flag_input.remove")}
                                      </button>
                                    `
                                  : null}
                                <button
                                  @click=${() => this.toggleColorPicker(index)}
                                  title="Change Color"
                                  class="text-sm px-2 py-1 bg-blue-600 rounded hover:bg-blue-500 text-white"
                                >
                                  ${translateText("flag_input.color")}
                                </button>
                              </div>
                            </div>

                            ${this.openColorIndex === index
                              ? html`
                                  <div
                                    class="flex flex-wrap gap-1 justify-start mt-1"
                                  >
                                    ${this.colorOptions.map((color) => {
                                      const isLocked =
                                        this.lockedColors.includes(color);
                                      const isSpecial = !color.startsWith("#");
                                      const colorClass = isSpecial
                                        ? `flag-color-${color}`
                                        : "";
                                      const inlineStyle = isSpecial
                                        ? ""
                                        : `background-color: ${color};`;

                                      return html`
                                        <button
                                          class="w-3 h-3 rounded-full border-2 relative
          ${this.selectedColor === color ? "border-white" : "border-gray-400"}
          ${isLocked ? "opacity-40 cursor-not-allowed" : ""}
          ${colorClass}"
                                          style=${inlineStyle}
                                          @click=${() => {
                                            if (
                                              !isLocked &&
                                              this.openColorIndex !== null
                                            ) {
                                              this.updateLayerColor(
                                                this.openColorIndex,
                                                color,
                                              );
                                            }
                                          }}
                                          @mouseenter=${(e: MouseEvent) => {
                                            if (isLocked) {
                                              this.hoveredColor = color;
                                            }
                                          }}
                                          @mousemove=${(e: MouseEvent) => {
                                            if (isLocked) {
                                              this.hoverPosition = {
                                                x: e.clientX,
                                                y: e.clientY,
                                              };
                                            }
                                          }}
                                          @mouseleave=${() => {
                                            this.hoveredColor = null;
                                          }}
                                          title=${color}
                                        >
                                          ${isLocked
                                            ? html`<img
                                                src=${locked}
                                                alt="Locked"
                                                class="absolute top-1/2 left-1/2 w-5 h-5 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                                              />`
                                            : ""}
                                        </button>
                                      `;
                                    })}
                                  </div>
                                `
                              : ""}
                          </li>
                        `;
                      })}
                    </ul>
                  </div>
                </div>
              </div>
            `}
      </o-modal>
    `;
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }
}
