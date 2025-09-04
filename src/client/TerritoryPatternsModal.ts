import type { TemplateResult } from "lit";
import { html, LitElement, render } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Pattern } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import "./components/Difficulties";
import "./components/PatternButton";
import { renderPatternPreview } from "./components/PatternButton";
import { fetchPatterns, handlePurchase } from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("territory-patterns-modal")
export class TerritoryPatternsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  public previewButton: HTMLElement | null = null;

  @state() private selectedPattern: Pattern | null;

  private patterns: Map<string, Pattern> = new Map();

  private userSettings: UserSettings = new UserSettings();

  private isActive = false;

  constructor() {
    super();
  }

  async onUserMe(userMeResponse: UserMeResponse | null) {
    if (userMeResponse === null) {
      this.userSettings.setSelectedPatternName(undefined);
      this.selectedPattern = null;
    }
    this.patterns = await fetchPatterns(userMeResponse);
    const storedPatternName = this.userSettings.getSelectedPatternName();
    if (storedPatternName) {
      this.selectedPattern = this.patterns.get(storedPatternName) ?? null;
    }
    this.refresh();
  }

  createRenderRoot() {
    return this;
  }

  private renderPatternGrid(): TemplateResult {
    const buttons: TemplateResult[] = [];
    for (const [name, pattern] of this.patterns) {
      buttons.push(html`
        <pattern-button
          .pattern=${pattern}
          .onSelect=${(p: Pattern | null) => this.selectPattern(p)}
          .onPurchase=${(p: Pattern) => handlePurchase(p)}
        ></pattern-button>
      `);
    }

    return html`
      <div
        class="flex flex-wrap gap-4 p-2"
        style="justify-content: center; align-items: flex-start;"
      >
        <pattern-button
          .pattern=${null}
          .onSelect=${(p: Pattern | null) => this.selectPattern(null)}
        ></pattern-button>
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

  public async open() {
    this.isActive = true;
    await this.refresh();
  }

  public close() {
    this.isActive = false;
    this.modalEl?.close();
  }

  private selectPattern(pattern: Pattern | null) {
    this.userSettings.setSelectedPatternName(pattern?.name);
    this.selectedPattern = pattern;
    this.refresh();
    this.close();
  }

  public async refresh() {
    const preview = renderPatternPreview(
      this.selectedPattern?.pattern ?? null,
      48,
      48,
    );
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
