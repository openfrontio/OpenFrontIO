import type { TemplateResult } from "lit";
import { html, LitElement, render } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { ColorPalette, Cosmetics, Pattern } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { PlayerPattern } from "../core/Schemas";
import "./components/Difficulties";
import "./components/PatternButton";
import { renderPatternPreview } from "./components/PatternButton";
import {
  fetchCosmetics,
  handlePurchase,
  patternRelationship,
} from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("territory-patterns-modal")
export class TerritoryPatternsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  public previewButton: HTMLElement | null = null;

  @state() private selectedPattern: PlayerPattern | null;
  @state() private selectedColor: string | null = null;

  @state() private activeTab: "patterns" | "colors" = "patterns";

  private cosmetics: Cosmetics | null = null;

  private userSettings: UserSettings = new UserSettings();

  private isActive = false;

  private affiliateCode: string | null = null;

  private userMeResponse: UserMeResponse | null = null;

  constructor() {
    super();
  }

  async onUserMe(userMeResponse: UserMeResponse | null) {
    if (userMeResponse === null) {
      this.userSettings.setSelectedPatternName(undefined);
      this.selectedPattern = null;
      this.selectedColor = null;
    }
    this.userMeResponse = userMeResponse;
    this.cosmetics = await fetchCosmetics();
    this.selectedPattern =
      this.cosmetics !== null
        ? this.userSettings.getSelectedPatternName(this.cosmetics)
        : null;
    this.selectedColor = this.userSettings.getSelectedColor() ?? null;
    this.refresh();
  }

  createRenderRoot() {
    return this;
  }

  private renderTabNavigation(): TemplateResult {
    return html`
      <div class="flex border-b border-gray-600 mb-4 justify-center">
        <button
          class="px-4 py-2 text-sm font-medium transition-colors duration-200 ${this
            .activeTab === "patterns"
            ? "text-blue-400 border-b-2 border-blue-400 bg-blue-400/10"
            : "text-gray-400 hover:text-white"}"
          @click=${() => (this.activeTab = "patterns")}
        >
          ${translateText("territory_patterns.title")}
        </button>
        <button
          class="px-4 py-2 text-sm font-medium transition-colors duration-200 ${this
            .activeTab === "colors"
            ? "text-blue-400 border-b-2 border-blue-400 bg-blue-400/10"
            : "text-gray-400 hover:text-white"}"
          @click=${() => (this.activeTab = "colors")}
        >
          ${translateText("territory_patterns.colors")}
        </button>
      </div>
    `;
  }

  private renderPatternGrid(): TemplateResult {
    const buttons: TemplateResult[] = [];
    for (const pattern of Object.values(this.cosmetics?.patterns ?? {})) {
      const colorPalettes = [...(pattern.colorPalettes ?? []), null];
      for (const colorPalette of colorPalettes) {
        const rel = patternRelationship(
          pattern,
          colorPalette,
          this.userMeResponse,
          this.affiliateCode,
        );
        if (rel === "blocked") {
          continue;
        }
        buttons.push(html`
          <pattern-button
            .pattern=${pattern}
            .colorPalette=${this.cosmetics?.colorPalettes?.[
              colorPalette?.name ?? ""
            ] ?? null}
            .requiresPurchase=${rel === "purchasable"}
            .onSelect=${(p: PlayerPattern | null) => this.selectPattern(p)}
            .onPurchase=${(p: Pattern, colorPalette: ColorPalette | null) =>
              handlePurchase(p, colorPalette)}
          ></pattern-button>
        `);
      }
    }

    return html`
      <div
        class="flex flex-wrap gap-4 p-2"
        style="justify-content: center; align-items: flex-start;"
      >
        ${this.affiliateCode === null
          ? html`
              <pattern-button
                .pattern=${null}
                .onSelect=${(p: Pattern | null) => this.selectPattern(null)}
              ></pattern-button>
            `
          : html``}
        ${buttons}
      </div>
    `;
  }

  private renderColorSwatchGrid(): TemplateResult {
    const hexCodes = (this.userMeResponse?.player.flares ?? [])
      .filter((flare) => flare.startsWith("color:"))
      .map((flare) => "#" + flare.split(":")[1]);
    return html`
      <div class="flex flex-wrap gap-3 p-2 justify-center items-center">
        ${hexCodes.map(
          (hexCode) => html`
            <div
              class="w-12 h-12 rounded-lg border-2 border-white/30 cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-lg"
              style="background-color: ${hexCode};"
              title="${hexCode}"
              @click=${() => this.selectColor(hexCode)}
            ></div>
          `,
        )}
      </div>
    `;
  }

  render() {
    if (!this.isActive) return html``;
    return html`
      <o-modal
        id="territoryPatternsModal"
        title="${this.activeTab === "patterns"
          ? translateText("territory_patterns.title")
          : translateText("territory_patterns.colors")}"
      >
        ${this.renderTabNavigation()}
        ${this.activeTab === "patterns"
          ? this.renderPatternGrid()
          : this.renderColorSwatchGrid()}
      </o-modal>
    `;
  }

  public async open(affiliateCode?: string) {
    this.isActive = true;
    this.affiliateCode = affiliateCode ?? null;
    await this.refresh();
  }

  public close() {
    this.isActive = false;
    this.affiliateCode = null;
    this.modalEl?.close();
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
    this.close();
  }

  private selectColor(hexCode: string) {
    this.selectedPattern = null;
    this.userSettings.setSelectedPatternName(undefined);
    this.selectedColor = hexCode;
    this.userSettings.setSelectedColor(hexCode);
    this.refresh();
    this.close();
  }

  private renderColorPreview(
    hexCode: string,
    width: number,
    height: number,
  ): TemplateResult {
    return html`
      <div
        class="rounded"
        style="width: ${width}px; height: ${height}px; background-color: ${hexCode};"
      ></div>
    `;
  }

  public async refresh() {
    const preview = this.selectedColor
      ? this.renderColorPreview(this.selectedColor, 48, 48)
      : renderPatternPreview(this.selectedPattern ?? null, 48, 48);
    this.requestUpdate();

    // Wait for the DOM to be updated and the o-modal element to be available
    await this.updateComplete;

    // Now modalEl should be available
    if (this.modalEl) {
      this.modalEl.open();
    } else {
      console.warn("modalEl is still null after updateComplete");
    }
    if (this.previewButton === null) return;
    render(preview, this.previewButton);
    this.requestUpdate();
  }
}
