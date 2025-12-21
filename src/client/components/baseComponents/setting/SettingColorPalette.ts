import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

interface ColorSwatch {
  id: string;
  name: string;
  description: string;
  defaultColor: string;
}

const DEFAULT_SWATCHES: ColorSwatch[] = [
  {
    id: "primary",
    name: "Primary",
    description: "Main accent color for UI elements",
    defaultColor: "#4CAF50",
  },
  {
    id: "secondary",
    name: "Secondary",
    description: "Secondary accent for highlights",
    defaultColor: "#2196F3",
  },
  {
    id: "territory",
    name: "Territory",
    description: "Your territory fill color",
    defaultColor: "#8BC34A",
  },
  {
    id: "border",
    name: "Border",
    description: "Territory border color",
    defaultColor: "#558B2F",
  },
  {
    id: "enemy",
    name: "Enemy",
    description: "Enemy territory highlight",
    defaultColor: "#F44336",
  },
  {
    id: "ally",
    name: "Ally",
    description: "Allied territory highlight",
    defaultColor: "#03A9F4",
  },
  {
    id: "neutral",
    name: "Neutral",
    description: "Unclaimed territory color",
    defaultColor: "#9E9E9E",
  },
  {
    id: "background",
    name: "Background",
    description: "UI panel backgrounds",
    defaultColor: "#1E1E1E",
  },
];

@customElement("setting-color-palette")
export class SettingColorPalette extends LitElement {
  @property({ type: Boolean }) disabled = false;

  @state() private selectedSwatchId: string = "primary";
  @state() private colors: Record<string, string> = {};
  @state() private hue = 120;
  @state() private saturation = 100;
  @state() private brightness = 50;

  static styles = css`
    :host {
      display: block;
    }

    .color-palette {
      display: flex;
      gap: 16px;
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 10px;
      padding: 16px;
    }

    .color-picker {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 200px;
    }

    .color-preview {
      width: 100%;
      height: 120px;
      border-radius: 8px;
      position: relative;
      overflow: hidden;
      cursor: crosshair;
    }

    .color-preview__gradient {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(to right, #fff, transparent),
        linear-gradient(to top, #000, transparent);
    }

    .color-preview__cursor {
      position: absolute;
      width: 16px;
      height: 16px;
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    .hue-slider {
      width: 100%;
      height: 16px;
      border-radius: 8px;
      background: linear-gradient(
        to right,
        #ff0000,
        #ffff00,
        #00ff00,
        #00ffff,
        #0000ff,
        #ff00ff,
        #ff0000
      );
      cursor: pointer;
      position: relative;
    }

    .hue-slider__thumb {
      position: absolute;
      width: 6px;
      height: 20px;
      background: white;
      border-radius: 3px;
      top: -2px;
      transform: translateX(-50%);
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
      pointer-events: none;
    }

    .alpha-slider {
      width: 100%;
      height: 16px;
      border-radius: 8px;
      background:
        linear-gradient(
          45deg,
          #666 25%,
          transparent 25%,
          transparent 75%,
          #666 75%
        ),
        linear-gradient(
          45deg,
          #666 25%,
          transparent 25%,
          transparent 75%,
          #666 75%
        );
      background-size: 8px 8px;
      background-position:
        0 0,
        4px 4px;
      position: relative;
      cursor: pointer;
      overflow: hidden;
    }

    .alpha-slider__gradient {
      position: absolute;
      inset: 0;
      border-radius: 8px;
    }

    .alpha-slider__thumb {
      position: absolute;
      width: 6px;
      height: 20px;
      background: white;
      border-radius: 3px;
      top: -2px;
      transform: translateX(-50%);
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
      pointer-events: none;
    }

    .color-input {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .color-input__swatch {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 2px solid #444;
      flex-shrink: 0;
    }

    .color-input__text {
      flex: 1;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 20px;
      padding: 8px 16px;
      color: #fff;
      font-family: monospace;
      font-size: 14px;
      text-align: center;
    }

    .color-input__text:focus {
      outline: none;
      border-color: #4caf50;
    }

    .swatch-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      flex: 1;
    }

    .swatch-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: #2a2a2a;
      border: 2px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .swatch-item:hover {
      background: #333;
    }

    .swatch-item.selected {
      border-color: #4caf50;
      background: rgba(76, 175, 80, 0.1);
    }

    .swatch-item__color {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      flex-shrink: 0;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .swatch-item__info {
      flex: 1;
      min-width: 0;
    }

    .swatch-item__name {
      font-size: 13px;
      font-weight: 500;
      color: #fff;
      margin-bottom: 2px;
    }

    .swatch-item__desc {
      font-size: 11px;
      color: #888;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .disabled-overlay {
      position: relative;
    }

    .disabled-overlay::after {
      content: "";
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      pointer-events: none;
    }

    .disabled-badge {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 200, 0, 0.9);
      color: #000;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      z-index: 1;
      white-space: nowrap;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.loadColors();
  }

  private loadColors() {
    const saved = localStorage.getItem("settings.colorPalette");
    if (saved) {
      try {
        this.colors = JSON.parse(saved);
      } catch {
        this.initializeDefaultColors();
      }
    } else {
      this.initializeDefaultColors();
    }
    this.updatePickerFromSelectedColor();
  }

  private initializeDefaultColors() {
    this.colors = DEFAULT_SWATCHES.reduce(
      (acc, swatch) => {
        acc[swatch.id] = swatch.defaultColor;
        return acc;
      },
      {} as Record<string, string>,
    );
  }

  private saveColors() {
    localStorage.setItem("settings.colorPalette", JSON.stringify(this.colors));
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { colors: this.colors },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private selectSwatch(id: string) {
    this.selectedSwatchId = id;
    this.updatePickerFromSelectedColor();
  }

  private updatePickerFromSelectedColor() {
    const color = this.colors[this.selectedSwatchId] || "#4CAF50";
    const { h, s, l } = this.hexToHsl(color);
    this.hue = h;
    this.saturation = s;
    this.brightness = l;
  }

  private hexToHsl(hex: string): { h: number; s: number; l: number } {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / d + 2) / 6;
          break;
        case b:
          h = ((r - g) / d + 4) / 6;
          break;
      }
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  private hslToHex(h: number, s: number, l: number): string {
    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;

    let r = 0,
      g = 0,
      b = 0;

    if (h >= 0 && h < 60) {
      r = c;
      g = x;
    } else if (h >= 60 && h < 120) {
      r = x;
      g = c;
    } else if (h >= 120 && h < 180) {
      g = c;
      b = x;
    } else if (h >= 180 && h < 240) {
      g = x;
      b = c;
    } else if (h >= 240 && h < 300) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }

    const toHex = (v: number) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, "0");

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  }

  private getCurrentColor(): string {
    return this.hslToHex(this.hue, this.saturation, this.brightness);
  }

  private handleColorPreviewClick(e: MouseEvent) {
    if (this.disabled) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.saturation = Math.max(
      0,
      Math.min(100, ((e.clientX - rect.left) / rect.width) * 100),
    );
    this.brightness = Math.max(
      0,
      Math.min(100, 100 - ((e.clientY - rect.top) / rect.height) * 100),
    );
    this.updateSelectedColor();
  }

  private handleHueClick(e: MouseEvent) {
    if (this.disabled) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.hue = Math.max(
      0,
      Math.min(360, ((e.clientX - rect.left) / rect.width) * 360),
    );
    this.updateSelectedColor();
  }

  private updateSelectedColor() {
    const color = this.getCurrentColor();
    this.colors = { ...this.colors, [this.selectedSwatchId]: color };
    this.saveColors();
  }

  private handleHexInput(e: Event) {
    if (this.disabled) return;
    const input = e.target as HTMLInputElement;
    let value = input.value.trim();
    if (!value.startsWith("#")) {
      value = "#" + value;
    }
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      this.colors = {
        ...this.colors,
        [this.selectedSwatchId]: value.toUpperCase(),
      };
      this.updatePickerFromSelectedColor();
      this.saveColors();
    }
  }

  render() {
    const currentColor = this.colors[this.selectedSwatchId] || "#4CAF50";
    const hueColor = this.hslToHex(this.hue, 100, 50);

    return html`
      <div
        class="color-palette ${this.disabled ? "disabled-overlay" : ""}"
        style="position: relative;"
      >
        ${this.disabled
          ? html`<div class="disabled-badge">Cosmetics Module Required</div>`
          : null}

        <div class="color-picker">
          <div
            class="color-preview"
            style="background-color: ${hueColor};"
            @click=${this.handleColorPreviewClick}
          >
            <div class="color-preview__gradient"></div>
            <div
              class="color-preview__cursor"
              style="left: ${this.saturation}%; top: ${100 - this.brightness}%;"
            ></div>
          </div>

          <div class="hue-slider" @click=${this.handleHueClick}>
            <div
              class="hue-slider__thumb"
              style="left: ${(this.hue / 360) * 100}%;"
            ></div>
          </div>

          <div class="color-input">
            <div
              class="color-input__swatch"
              style="background-color: ${currentColor};"
            ></div>
            <input
              type="text"
              class="color-input__text"
              .value=${currentColor}
              @change=${this.handleHexInput}
              ?disabled=${this.disabled}
            />
          </div>
        </div>

        <div class="swatch-grid">
          ${DEFAULT_SWATCHES.map(
            (swatch) => html`
              <div
                class="swatch-item ${this.selectedSwatchId === swatch.id
                  ? "selected"
                  : ""}"
                @click=${() => this.selectSwatch(swatch.id)}
              >
                <div
                  class="swatch-item__color"
                  style="background-color: ${this.colors[swatch.id] ||
                  swatch.defaultColor};"
                ></div>
                <div class="swatch-item__info">
                  <div class="swatch-item__name">${swatch.name}</div>
                  <div class="swatch-item__desc">${swatch.description}</div>
                </div>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }
}
