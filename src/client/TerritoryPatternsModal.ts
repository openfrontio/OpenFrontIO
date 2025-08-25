import { base64url } from "jose";
import type { TemplateResult } from "lit";
import { html, LitElement, render } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Pattern } from "../core/CosmeticSchemas";
import { UserSettings } from "../core/game/UserSettings";
import { PatternDecoder } from "../core/PatternDecoder";
import "./components/Difficulties";
import "./components/PatternButton";
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

  @state() private keySequence: string[] = [];
  @state() private showChocoPattern = false;

  private patterns: Map<string, Pattern> = new Map();

  private userSettings: UserSettings = new UserSettings();

  private isActive = false;

  constructor() {
    super();
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
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

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }

    const key = e.key.toLowerCase();
    const nextSequence = [...this.keySequence, key].slice(-5);
    this.keySequence = nextSequence;

    if (nextSequence.join("") === "choco") {
      this.triggerChocoEasterEgg();
      this.keySequence = [];
    }
  };

  private triggerChocoEasterEgg() {
    console.log("🍫 Choco pattern unlocked!");
    this.showChocoPattern = true;

    const popup = document.createElement("div");
    popup.className = "easter-egg-popup";
    popup.textContent = "🎉 You unlocked the Choco pattern!";
    document.body.appendChild(popup);

    setTimeout(() => {
      popup.remove();
    }, 5000);

    this.requestUpdate();
  }

  createRenderRoot() {
    return this;
  }

  private renderPatternGrid(): TemplateResult {
    const buttons: TemplateResult[] = [];
    for (const [name, pattern] of this.patterns) {
      if (!this.showChocoPattern && name === "choco") continue;

      buttons.push(html`
        <pattern-button
          .pattern=${pattern}
          .onSelect=${(p: Pattern | null) => this.selectPattern(p)}
          .onPurchase=${(priceId: string) => handlePurchase(priceId)}
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
    window.addEventListener("keydown", this.handleKeyDown);
  }

  public close() {
    this.isActive = false;
    this.modalEl?.close();
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  private selectPattern(pattern: Pattern | null) {
    this.userSettings.setSelectedPatternName(pattern?.name);
    this.selectedPattern = pattern;
    this.refresh();
    this.close();
  }

  private renderPatternPreview(
    pattern?: string,
    width?: number,
    height?: number,
  ): TemplateResult {
    return html`
      <img src="${generatePreviewDataUrl(pattern, width, height)}"></img>
    `;
  }

  public async refresh() {
    const preview = this.renderPatternPreview(
      this.selectedPattern?.pattern,
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

const patternCache = new Map<string, string>();
const DEFAULT_PATTERN_B64 = "AAAAAA"; // Empty 2x2 pattern
const COLOR_SET = [0, 0, 0, 255]; // Black
const COLOR_UNSET = [255, 255, 255, 255]; // White
export function generatePreviewDataUrl(
  pattern?: string,
  width?: number,
  height?: number,
): string {
  pattern ??= DEFAULT_PATTERN_B64;
  const patternLookupKey = `${pattern}-${width}-${height}`;

  if (patternCache.has(patternLookupKey)) {
    return patternCache.get(patternLookupKey)!;
  }

  // Calculate canvas size
  let decoder: PatternDecoder;
  try {
    decoder = new PatternDecoder(pattern, base64url.decode);
  } catch (e) {
    console.error("Error decoding pattern", e);
    return "";
  }

  const scaledWidth = decoder.scaledWidth();
  const scaledHeight = decoder.scaledHeight();

  width =
    width === undefined
      ? scaledWidth
      : Math.max(1, Math.floor(width / scaledWidth)) * scaledWidth;
  height =
    height === undefined
      ? scaledHeight
      : Math.max(1, Math.floor(height / scaledHeight)) * scaledHeight;

  // Create the canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context not supported");

  // Create an image
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgba = decoder.isSet(x, y) ? COLOR_SET : COLOR_UNSET;
      data[i++] = rgba[0]; // Red
      data[i++] = rgba[1]; // Green
      data[i++] = rgba[2]; // Blue
      data[i++] = rgba[3]; // Alpha
    }
  }

  // Create a data URL
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  patternCache.set(patternLookupKey, dataUrl);
  return dataUrl;
}
