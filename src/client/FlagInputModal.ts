import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { UserMeResponse } from "../core/ApiSchemas";
import { COSMETICS } from "../core/CosmeticSchemas";
import Countries from "./data/countries.json";
import { FlagInput } from "./FlagInput";

const flagKey: string = "flag";
const MAX_LAYER = 10;

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
  @state() private search: string = "";
  @state() private showModal: boolean = false;
  @state() private activeTab: "real" | "custom" = "real";
  @state() private me: UserMeResponse | null = null;

  private readonly LayerShortNames: Record<string, string> = Object.fromEntries(
    Object.entries(COSMETICS.flag.layers).map(([shortKey, { name }]) => [
      name,
      shortKey,
    ]),
  );

  private readonly ColorShortNames: Record<string, string> = Object.fromEntries(
    Object.entries(COSMETICS.flag.color).map(([shortKey, { color }]) => [
      color,
      shortKey,
    ]),
  );

  private readonly FlagMap: Record<string, string> = Object.fromEntries(
    Object.entries(COSMETICS.flag.layers).map(([shortKey, layer]) => {
      const svgPath = `/flags/custom/${layer.name}.svg`;
      return [layer.name, svgPath];
    }),
  );

  private checkPermission(
    flag: string,
    roles: readonly string[] | undefined,
    flares: readonly string[] | undefined,
  ): [string[], string[], Record<string, string>, number] {
    const lockedLayers: string[] = [];
    const lockedColors: string[] = [];
    const lockedReasons: Record<string, string> = {};

    // Helper functions to lock layers/colors
    function lock(layerKeys: string[], reason: string) {
      for (const key of layerKeys) {
        if (!lockedLayers.includes(key)) {
          lockedLayers.push(key);
          lockedReasons[key] = reason;
        }
      }
    }
    function lockColor(colorKeys: string[], reason: string) {
      for (const key of colorKeys) {
        if (!lockedColors.includes(key)) {
          lockedColors.push(key);
          lockedReasons[key] = reason;
        }
      }
    }

    // Iterate all flag layers
    for (const layerKey in COSMETICS.flag.layers) {
      const spec = COSMETICS.flag.layers[layerKey];
      // Determine if allowed
      let allowed = false;
      if (!spec.role_group && !spec.flares) {
        allowed = true;
      } else {
        // By role
        if (spec.role_group) {
          const group = Array.isArray(spec.role_group)
            ? spec.role_group
            : [spec.role_group];
          if (roles?.some((r) => group.includes(r))) allowed = true;
        }
        // By flare
        if (spec.flares && flares?.some((f) => spec.flares!.includes(f)))
          allowed = true;
        // Named flare
        if (flares?.includes(`flag:layer:${spec.name}`)) allowed = true;
      }
      if (!allowed) {
        lock([spec.name], "flag_input.reason.restricted");
      }
    }

    // Iterate all flag colors
    for (const colorKey in COSMETICS.flag.color) {
      const spec = COSMETICS.flag.color[colorKey];
      let allowed = false;
      if (!spec.role_group && !spec.flares) {
        allowed = true;
      } else {
        if (spec.role_group) {
          const group = Array.isArray(spec.role_group)
            ? spec.role_group
            : [spec.role_group];
          if (roles?.some((r) => group.includes(r))) allowed = true;
        }
        if (spec.flares && flares?.some((f) => spec.flares!.includes(f)))
          allowed = true;
        if (flares?.includes(`flag:color:${spec.name}`)) allowed = true;
      }
      if (!allowed) {
        lockColor([spec.color], "flag_input.reason.restricted");
      }
    }
    // return [lockedLayers, lockedColors, lockedReasons, MAX_LAYER];
    return [[], [], {}, 10]; // TODO: REMOVE BEFORE MERGE
  }

  private readonly colorOptions: string[] = Object.keys(this.ColorShortNames);

  @state() private customLayers: { name: string; color: string }[] = [];

  @state() private hoveredColor: string | null = null;
  @state() private hoverPosition = { x: 0, y: 0 };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .flag-modal {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .grid {
      flex-grow: 1;
      overflow-y: auto;
    }

    .flex-col {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .overflow-hidden {
      overflow: hidden;
    }

    .overflow-y-auto {
      overflow-y: auto;
    }
  `;

  private handleSearch(e: Event) {
    this.search = String((e.target as HTMLInputElement).value);
  }

  private setFlag(flag: string) {
    if (flag === "xx") {
      flag = "";
    }
    this.flag = flag;
    this.dispatchFlagEvent();
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

  public onUserMe(userMeResponse: UserMeResponse) {
    const { player } = userMeResponse;
    const { roles, flares } = player;
    this.me = userMeResponse;
    // Recalculate permissions when user info arrives
    const result = this.checkPermission(this.flag, roles, flares);
    this.lockedLayers = Array.isArray(result[0]) ? result[0] : [result[0]];
    this.lockedColors = Array.isArray(result[1]) ? result[1] : [result[1]];
    this.lockedReasons = result[2] || {};
    this.requestUpdate();
  }

  private lockedLayers: string[] = [];

  private lockedColors: string[] = [];

  private lockedReasons: Record<string, string> = {};

  private isCustomFlag(flag: string): boolean {
    return flag.startsWith("!");
  }

  private decodeCustomFlag(code: string): { name: string; color: string }[] {
    if (!this.isCustomFlag(code)) return [];

    const short = code.replace("!", "");
    const reverseNameMap = Object.fromEntries(
      Object.entries(this.LayerShortNames).map(([k, v]) => [v, k]),
    );
    const reverseColorMap = Object.fromEntries(
      Object.entries(this.ColorShortNames).map(([k, v]) => [v, k]),
    );

    return short.split("_").map((segment) => {
      const [shortName, shortColor] = segment.split("-");
      const name = reverseNameMap[shortName] || shortName;
      const color = reverseColorMap[shortColor] || `#${shortColor}`;
      return { name, color };
    });
  }

  render() {
    const result = this.checkPermission(
      this.flag,
      this.me?.player.roles,
      this.me?.player.flares,
    );
    this.lockedLayers = Array.isArray(result[0]) ? result[0] : [result[0]];
    this.lockedColors = Array.isArray(result[1]) ? result[1] : [result[1]];
    this.lockedReasons = result[2] || {};
    const FlagMap = this.FlagMap;
    const ColorShortNames = this.ColorShortNames;
    return html`
      ${this.hoveredColor && this.lockedReasons[this.hoveredColor]
        ? html`
            <div
              class="fixed z-[10000] px-3 py-2 rounded bg-black text-white text-sm pointer-events-none shadow-md"
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
        heightRatio="0.75"
        disableScroll="true"
        special="true"
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
          ? this.renderRealFlagTab()
          : this.renderCustomFlagTab()}
      </o-modal>
    `;
  }

  private renderRealFlagTab() {
    return html`
      <input
        class="h-[2rem] border-none text-center border border-gray-300 rounded-xl shadow-sm text-2xl text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black dark:border-gray-300/60 dark:bg-gray-700 dark:text-white"
        type="text"
        placeholder="Search..."
        @change=${this.handleSearch}
        @keyup=${this.handleSearch}
      />
      <div
        class="flex flex-wrap justify-evenly gap-[1rem] overflow-y-auto overflow-x-hidden h-[90%]"
      >
        ${Countries.filter(
          (country) =>
            country.name.toLowerCase().includes(this.search.toLowerCase()) ||
            country.code.toLowerCase().includes(this.search.toLowerCase()),
        ).map(
          (country) => html`
            <button
              @click=${() => {
                this.setFlag(country.code);
                this.close();
              }}
              class="text-center cursor-pointer border-none bg-none opacity-70 
                w-[calc(100%/2-15px)] sm:w-[calc(100%/4-15px)] 
                md:w-[calc(100%/6-15px)] lg:w-[calc(100%/8-15px)] 
                xl:w-[calc(100%/10-15px)] min-w-[80px]"
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
    `;
  }

  private renderCustomFlagTab() {
    return html``;
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }
}
