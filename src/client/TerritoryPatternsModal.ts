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
    }
    this.userMeResponse = userMeResponse;
    this.cosmetics = await fetchCosmetics();
    this.selectedPattern =
      this.cosmetics !== null
        ? this.userSettings.getSelectedPatternName(this.cosmetics)
        : null;
    this.refresh();
  }

  createRenderRoot() {
    return this;
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

  render() {
    if (!this.isActive) return html``;
    return html`
      <o-modal
        id="territoryPatternsModal"
        title="${translateText("territory_patterns.title")}"
      >
        ${this.renderPatternGrid()}
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

  public async refresh() {
    const preview = renderPatternPreview(this.selectedPattern ?? null, 48, 48);
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
