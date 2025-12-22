import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

interface Skin {
  id: string;
  name: string;
  thumbnail: string;
  premium?: boolean;
}

// Placeholder skins with gradient backgrounds
const AVAILABLE_SKINS: Skin[] = [
  {
    id: "marble",
    name: "Marble Flow",
    thumbnail:
      "linear-gradient(135deg, #ff6b6b 0%, #feca57 25%, #48dbfb 50%, #ff9ff3 75%, #54a0ff 100%)",
    premium: true,
  },
  {
    id: "psychedelic",
    name: "Psychedelic",
    thumbnail: "linear-gradient(45deg, #f093fb 0%, #f5576c 50%, #4facfe 100%)",
    premium: true,
  },
  {
    id: "circuit",
    name: "Circuit Board",
    thumbnail: "linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 50%, #ff00ff 100%)",
    premium: true,
  },
  {
    id: "holographic",
    name: "Holographic",
    thumbnail:
      "linear-gradient(135deg, #a8edea 0%, #fed6e3 25%, #d299c2 50%, #fef9d7 75%, #a8edea 100%)",
  },
  {
    id: "geometric",
    name: "Geometric",
    thumbnail: "linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)",
  },
  {
    id: "qr-pattern",
    name: "QR Pattern",
    thumbnail: "linear-gradient(135deg, #232526 0%, #414345 50%, #232526 100%)",
    premium: true,
  },
  {
    id: "abstract",
    name: "Abstract Art",
    thumbnail: "linear-gradient(135deg, #fa709a 0%, #fee140 50%, #fa709a 100%)",
  },
  {
    id: "pastel",
    name: "Pastel Dream",
    thumbnail: "linear-gradient(135deg, #ffecd2 0%, #fcb69f 50%, #ffecd2 100%)",
  },
  {
    id: "neon",
    name: "Neon Nights",
    thumbnail: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
    premium: true,
  },
  {
    id: "triangles",
    name: "Triangles",
    thumbnail: "linear-gradient(135deg, #11998e 0%, #38ef7d 50%, #11998e 100%)",
  },
  {
    id: "cosmos",
    name: "Cosmos",
    thumbnail: "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)",
    premium: true,
  },
  {
    id: "confetti",
    name: "Confetti",
    thumbnail: "linear-gradient(135deg, #f5af19 0%, #f12711 50%, #f5af19 100%)",
  },
];

// Default nebula skin preview
const DEFAULT_PREVIEW =
  "linear-gradient(135deg, #1a1a2e 0%, #16213e 20%, #0f3460 40%, #533483 60%, #e94560 80%, #1a1a2e 100%)";

@customElement("setting-territory-skins")
export class SettingTerritorySkins extends LitElement {
  @property({ type: Boolean }) disabled = false;

  @state() private selectedSkinId: string = "cosmos";
  @state() private customSkinUrl: string | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .territory-skins {
      display: flex;
      gap: 16px;
      background: var(--modal-card-bg, #1e1e1e);
      border: 1px solid var(--modal-card-border, #333);
      border-radius: 10px;
      padding: 12px;
      box-sizing: border-box;
      width: 100%;
    }

    .preview-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }

    .preview-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--modal-text, #fff);
      margin-bottom: 4px;
    }

    .skin-preview {
      width: 100%;
      aspect-ratio: 16 / 9;
      border-radius: 12px;
      background-size: cover;
      background-position: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      border: 2px solid var(--modal-card-border, #444);
    }

    .preview-actions {
      display: flex;
      gap: 8px;
    }

    .btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
    }

    .btn--secondary {
      background: #f5f5f5;
      color: #333;
    }

    .btn--secondary:hover {
      background: #e0e0e0;
    }

    .btn--primary {
      background: #4285f4;
      color: #fff;
    }

    .btn--primary:hover {
      background: #3367d6;
    }

    .btn__icon {
      width: 16px;
      height: 16px;
    }

    .skins-section {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .skins-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--modal-text, #fff);
      margin-bottom: 8px;
      flex-shrink: 0;
    }

    .skins-grid-container {
      overflow-y: auto;
      max-height: 250px;
    }

    .skins-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 8px;
    }

    .skin-item {
      position: relative;
      aspect-ratio: 1;
      border-radius: 8px;
      background-size: cover;
      background-position: center;
      cursor: pointer;
      transition: all 0.2s ease;
      border: 2px solid transparent;
    }

    .skin-item:hover {
      transform: scale(1.05);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .skin-item.selected {
      border-color: #4caf50;
      box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.3);
    }

    .skin-item__badge {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 18px;
      height: 18px;
      background: rgba(0, 0, 0, 0.6);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .skin-item__badge svg {
      width: 12px;
      height: 12px;
      fill: #ffd700;
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

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.loadSkin();
  }

  private loadSkin() {
    const saved = localStorage.getItem("settings.territorySkin");
    if (saved) {
      this.selectedSkinId = saved;
    }
    const customUrl = localStorage.getItem("settings.territorySkinCustom");
    if (customUrl) {
      this.customSkinUrl = customUrl;
    }
  }

  private saveSkin() {
    localStorage.setItem("settings.territorySkin", this.selectedSkinId);
    if (this.customSkinUrl) {
      localStorage.setItem("settings.territorySkinCustom", this.customSkinUrl);
    }
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { skinId: this.selectedSkinId, customUrl: this.customSkinUrl },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private selectSkin(id: string) {
    if (this.disabled) return;
    this.selectedSkinId = id;
    this.customSkinUrl = null;
    this.saveSkin();
  }

  private getPreviewBackground(): string {
    if (this.customSkinUrl) {
      return `url(${this.customSkinUrl})`;
    }
    const skin = AVAILABLE_SKINS.find((s) => s.id === this.selectedSkinId);
    return skin?.thumbnail ?? DEFAULT_PREVIEW;
  }

  private handleUploadClick() {
    if (this.disabled) return;
    // Create hidden file input
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          this.customSkinUrl = reader.result as string;
          this.selectedSkinId = "custom";
          this.saveSkin();
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }

  private handleSaveClick() {
    if (this.disabled) return;
    this.saveSkin();
  }

  // Premium badge SVG icon
  private renderPremiumBadge() {
    return html`
      <div class="skin-item__badge">
        <svg viewBox="0 0 24 24">
          <path
            d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
          />
        </svg>
      </div>
    `;
  }

  // Upload icon SVG
  private renderUploadIcon() {
    return html`
      <svg class="btn__icon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />
      </svg>
    `;
  }

  // Save icon SVG
  private renderSaveIcon() {
    return html`
      <svg class="btn__icon" viewBox="0 0 24 24" fill="currentColor">
        <path
          d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"
        />
      </svg>
    `;
  }

  render() {
    const previewBg = this.getPreviewBackground();

    return html`
      <div
        class="territory-skins ${this.disabled ? "disabled-overlay" : ""}"
        style="position: relative;"
      >
        ${this.disabled
          ? html`<div class="disabled-badge">Cosmetics Module Required</div>`
          : null}

        <div class="preview-section">
          <div class="preview-label">Territory Skins</div>
          <div class="skin-preview" style="background: ${previewBg};"></div>
          <div class="preview-actions">
            <button
              class="btn btn--secondary"
              @click=${this.handleUploadClick}
              ?disabled=${this.disabled}
            >
              ${this.renderUploadIcon()} Upload File
            </button>
            <button
              class="btn btn--primary"
              @click=${this.handleSaveClick}
              ?disabled=${this.disabled}
            >
              ${this.renderSaveIcon()} Save
            </button>
          </div>
        </div>

        <div class="skins-section">
          <div class="skins-label">Available Skins</div>
          <div class="skins-grid-container">
            <div class="skins-grid">
              ${AVAILABLE_SKINS.map(
                (skin) => html`
                  <div
                    class="skin-item ${this.selectedSkinId === skin.id
                      ? "selected"
                      : ""}"
                    style="background: ${skin.thumbnail};"
                    @click=${() => this.selectSkin(skin.id)}
                    title="${skin.name}"
                  >
                    ${skin.premium ? this.renderPremiumBadge() : null}
                  </div>
                `,
              )}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
