import type { TemplateResult } from "lit";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { ColorPalette, Cosmetics, Pattern } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { PlayerPattern } from "../core/Schemas";
import { hasLinkedAccount } from "./Api";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import "./components/PatternButton";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  fetchCosmetics,
  getPlayerCosmetics,
  handlePurchase,
  patternRelationship,
} from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("territory-patterns-modal")
export class TerritoryPatternsModal extends BaseModal {
  public previewButton: HTMLElement | null = null;

  @state() private selectedPattern: PlayerPattern | null;
  @state() private selectedColor: string | null = null;

  @state() private activeTab: "patterns" | "colors" = "patterns";
  @state() private showOnlyOwned: boolean = false;

  private cosmetics: Cosmetics | null = null;

  private userSettings: UserSettings = new UserSettings();

  private isActive = false;

  private affiliateCode: string | null = null;

  private userMeResponse: UserMeResponse | false = false;

  private _onPatternSelected = async () => {
    await this.updateFromSettings();
    this.refresh();
  };

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      (event: CustomEvent<UserMeResponse | false>) => {
        this.onUserMe(event.detail);
      },
    );
    window.addEventListener("pattern-selected", this._onPatternSelected);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pattern-selected", this._onPatternSelected);
  }

  private async updateFromSettings() {
    const cosmetics = await getPlayerCosmetics();
    this.selectedPattern = cosmetics.pattern ?? null;
    this.selectedColor = cosmetics.color?.color ?? null;
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    this.userMeResponse = userMeResponse;
    this.cosmetics = await fetchCosmetics();
    await this.updateFromSettings();
    this.refresh();
  }

  private renderTabNavigation(): TemplateResult {
    return html`
      ${modalHeader({
        title: translateText("territory_patterns.title"),
        onBack: () => this.close(),
        ariaLabel: translateText("common.back"),
        rightContent: !hasLinkedAccount(this.userMeResponse)
          ? html`<div class="flex items-center">
              ${this.renderNotLoggedInWarning()}
            </div>`
          : undefined,
      })}
      <!-- TEMP DISABlE TAB SWITCHING
        <div class="flex items-center gap-2 justify-center">
          <button
            class="px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest ${this
        .activeTab === "patterns"
        ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
        : "text-white/40 hover:text-white hover:bg-white/5 border border-transparent"}"
            @click=${() => (this.activeTab = "patterns")}
          >
            ${translateText("territory_patterns.title")}
          </button>
          <button
            class="px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest ${this
        .activeTab === "colors"
        ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
        : "text-white/40 hover:text-white hover:bg-white/5 border border-transparent"}"
            @click=${() => (this.activeTab = "colors")}
          >
            ${translateText("territory_patterns.colors")}
          </button>
          TEMP DISABlE TAB SWITCHING -->
    `;
  }

  private renderPatternGrid(): TemplateResult {
    const buttons: TemplateResult[] = [];
    const ownedPatterns: PlayerPattern[] = [];
    const patterns: (Pattern | null)[] = [
      null,
      ...Object.values(this.cosmetics?.patterns ?? {}),
    ];
    for (const pattern of patterns) {
      const colorPalettes = pattern
        ? [...(pattern.colorPalettes ?? []), null]
        : [null];
      for (const colorPalette of colorPalettes) {
        let rel = "owned";
        if (pattern) {
          rel = patternRelationship(
            pattern,
            colorPalette,
            this.userMeResponse,
            this.affiliateCode,
          );
        }
        if (rel === "owned" && pattern !== null) {
          ownedPatterns.push({
            name: pattern.name,
            patternData: pattern.pattern,
            colorPalette:
              this.cosmetics?.colorPalettes?.[colorPalette?.name ?? ""] ??
              undefined,
          });
        }
        if (rel === "blocked") {
          continue;
        }
        if (this.showOnlyOwned) {
          if (rel !== "owned") continue;
        } else {
          // Store mode: hide owned items
          if (rel === "owned") continue;
        }
        // Determine if this pattern/color is selected
        const isDefaultPattern = pattern === null;
        const isSelected =
          (isDefaultPattern && this.selectedPattern === null) ||
          (!isDefaultPattern &&
            this.selectedPattern &&
            this.selectedPattern.name === pattern?.name &&
            (this.selectedPattern.colorPalette?.name ?? null) ===
              (colorPalette?.name ?? null));
        buttons.push(html`
          <pattern-button
            .pattern=${pattern}
            .colorPalette=${this.cosmetics?.colorPalettes?.[
              colorPalette?.name ?? ""
            ] ?? null}
            .requiresPurchase=${rel === "purchasable"}
            .selected=${isSelected}
            .onSelect=${(p: PlayerPattern | null) => this.selectPattern(p)}
            .onPurchase=${(p: Pattern, colorPalette: ColorPalette | null) =>
              handlePurchase(p, colorPalette)}
          ></pattern-button>
        `);
      }
    }

    // Insert random skin tile after "Default" when viewing owned skins
    if (this.showOnlyOwned && ownedPatterns.length >= 1) {
      const randomTile = html`
        <div
          class="flex flex-col items-center justify-between gap-2 p-3 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl w-48 h-full transition-all duration-200 hover:bg-white/10 hover:border-white/20 hover:shadow-xl"
        >
          <button
            class="group relative flex flex-col items-center w-full gap-2 rounded-lg cursor-pointer transition-all duration-200 flex-1"
            @click=${() => this.selectRandomPattern()}
          >
            <div class="flex flex-col items-center w-full">
              <div
                class="text-xs font-bold text-white uppercase tracking-wider mb-1 text-center truncate w-full"
              >
                ${translateText("territory_patterns.random_skin")}
              </div>
              <div class="h-[22px] mb-2 w-full"></div>
            </div>
            <div
              class="w-full aspect-square flex items-center justify-center bg-white/5 rounded-lg p-2 border border-white/10 group-hover:border-white/20 transition-colors duration-200 overflow-hidden"
            >
              <span class="text-5xl">🎲</span>
            </div>
          </button>
        </div>
      `;
      buttons.splice(1, 0, randomTile);
    }

    return html`
      <div class="flex flex-col">
        <div class="pt-4 flex justify-center">
          ${hasLinkedAccount(this.userMeResponse)
            ? this.renderMySkinsButton()
            : html``}
        </div>
        ${!this.showOnlyOwned && buttons.length === 0
          ? html`<div
              class="text-white/40 text-sm font-bold uppercase tracking-wider text-center py-8"
            >
              ${translateText("territory_patterns.all_owned")}
            </div>`
          : html`
              <div
                class="flex flex-wrap gap-4 p-2 justify-center items-stretch content-start"
              >
                ${buttons}
              </div>
            `}
      </div>
    `;
  }

  private renderMySkinsButton(): TemplateResult {
    return html`<button
      class="px-4 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-wider border mb-4 ${this
        .showOnlyOwned
        ? "bg-blue-500/20 text-blue-400 border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]"
        : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white"}"
      @click=${() => {
        this.showOnlyOwned = !this.showOnlyOwned;
      }}
    >
      ${translateText("territory_patterns.show_only_owned")}
    </button>`;
  }

  private renderNotLoggedInWarning(): TemplateResult {
    return html`<button
      class="px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 cursor-pointer hover:bg-red-500/30"
      @click=${() => {
        this.close();
        window.showPage?.("page-account");
      }}
    >
      ${translateText("territory_patterns.not_logged_in")}
    </button>`;
  }

  private renderColorSwatchGrid(): TemplateResult {
    const hexCodes = (
      this.userMeResponse === false
        ? []
        : (this.userMeResponse.player.flares ?? [])
    )
      .filter((flare) => flare.startsWith("color:"))
      .map((flare) => flare.split(":")[1]);
    return html`
      <div class="flex flex-wrap gap-3 p-2 justify-center items-center">
        ${hexCodes.map(
          (hexCode) => html`
            <div
              class="w-12 h-12 rounded-xl border-2 border-white/10 cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-[0_0_15px_rgba(255,255,255,0.3)] hover:border-white relative group"
              style="background-color: ${hexCode};"
              title="${hexCode}"
              @click=${() => this.selectColor(hexCode)}
            >
              <div
                class="absolute inset-0 rounded-xl ring-2 ring-inset ring-black/20"
              ></div>
            </div>
          `,
        )}
      </div>
    `;
  }

  render() {
    if (!this.isActive && !this.inline) return html``;

    const content = html`
      <div class="${this.modalContainerClass}">
        ${this.renderTabNavigation()}
        <div class="overflow-y-auto pr-2 custom-scrollbar mr-1">
          ${this.activeTab === "patterns"
            ? this.renderPatternGrid()
            : this.renderColorSwatchGrid()}
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="territoryPatternsModal"
        title="${this.activeTab === "patterns"
          ? translateText("territory_patterns.title")
          : translateText("territory_patterns.colors")}"
        ?inline=${this.inline}
        ?hideHeader=${true}
        ?hideCloseButton=${true}
      >
        ${content}
      </o-modal>
    `;
  }

  public async open(
    options?: string | { affiliateCode?: string; showOnlyOwned?: boolean },
  ) {
    this.isActive = true;
    if (typeof options === "string") {
      this.affiliateCode = options;
      this.showOnlyOwned = false;
    } else if (
      options !== null &&
      typeof options === "object" &&
      !Array.isArray(options)
    ) {
      this.affiliateCode = options.affiliateCode ?? null;
      this.showOnlyOwned = options.showOnlyOwned ?? false;
    } else {
      this.affiliateCode = null;
      this.showOnlyOwned = false;
    }

    await this.refresh();
    super.open();
  }

  public close() {
    this.isActive = false;
    this.affiliateCode = null;
    super.close();
  }

  private selectRandomPattern() {
    this.selectedColor = null;
    this.userSettings.setSelectedColor(undefined);
    this.userSettings.setSelectedPatternName("random");
    this.selectedPattern = null;
    this.refresh();
    this.dispatchEvent(new CustomEvent("pattern-selected", { bubbles: true }));
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: `${translateText("territory_patterns.random_skin")} ${translateText("territory_patterns.selected")}`,
          duration: 2000,
        },
      }),
    );
    this.close();
  }

  private selectPattern(pattern: PlayerPattern | null) {
    this.selectedColor = null;
    this.userSettings.setSelectedColor(undefined);
    if (pattern === null) {
      this.userSettings.setSelectedPatternName(undefined);
    } else {
      const name =
        pattern.colorPalette?.name === undefined
          ? pattern.name
          : `${pattern.name}:${pattern.colorPalette.name}`;
      this.userSettings.setSelectedPatternName(`pattern:${name}`);
    }
    this.selectedPattern = pattern;
    this.refresh();
    // Dispatch event so Main.ts can refresh the preview button
    this.dispatchEvent(new CustomEvent("pattern-selected", { bubbles: true }));
    // Show popup/modal for skin selection
    this.showSkinSelectedPopup();
    // Close the skin store
    this.close();
  }

  private showSkinSelectedPopup() {
    // Use unified heads-up-message for feedback
    let skinName = translateText("territory_patterns.pattern.default");
    if (this.selectedPattern && this.selectedPattern.name) {
      skinName = this.selectedPattern.name
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      if (
        this.selectedPattern.colorPalette &&
        this.selectedPattern.colorPalette.name
      ) {
        skinName += ` (${this.selectedPattern.colorPalette.name})`;
      }
    }
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: `${skinName} ${translateText("territory_patterns.selected")}`,
          duration: 2000,
        },
      }),
    );
  }

  private selectColor(hexCode: string) {
    this.selectedPattern = null;
    this.userSettings.setSelectedPatternName(undefined);
    this.selectedColor = hexCode;
    this.userSettings.setSelectedColor(hexCode);
    this.refresh();
    this.dispatchEvent(new CustomEvent("pattern-selected", { bubbles: true }));
    this.close();
  }

  private renderColorPreview(
    hexCode: string,
    width: number,
    height: number,
  ): TemplateResult {
    return html`
      <div
        class="w-full h-full rounded"
        style="background-color: ${hexCode};"
      ></div>
    `;
  }

  public async refresh() {
    this.requestUpdate();
  }
}
