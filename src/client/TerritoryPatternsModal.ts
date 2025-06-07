import type { TemplateResult } from "lit";
import { html, LitElement, render } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { territoryPatterns } from "../core/Util";
import "./components/Difficulties";
import "./components/Maps";
import {
  getSelectedPattern,
  PatternDecoder,
  setSelectedPattern,
  setSelectedPatternBase64,
} from "./Cosmetic";

@customElement("territory-patterns-modal")
export class TerritoryPatternsModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @query("#territory-patterns-input-preview-button")
  private previewButton!: HTMLElement;

  @state() private selectedPattern = getSelectedPattern();

  @state() private buttonWidth: number = 100;

  @state() private lockedPatterns: string[] = [];
  @state() private lockedReasons: Record<string, string> = {};
  @state() private hoveredPattern: string | null = null;
  @state() private hoverPosition = { x: 0, y: 0 };

  @state() private keySequence: string[] = [];
  @state() private showChocoPattern = false;

  @state() private roles: string[] = [];

  private resizeObserver: ResizeObserver;

  constructor() {
    super();
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target.classList.contains("preview-container")) {
          this.buttonWidth = entry.contentRect.width;
        }
      }
    });
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
    this.updateComplete.then(() => {
      const containers = this.renderRoot.querySelectorAll(".preview-container");
      containers.forEach((container) => this.resizeObserver.observe(container));
      this.updatePreview();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.handleKeyDown);
    this.resizeObserver.disconnect();
  }

  onUserMe(userMeResponse: UserMeResponse) {
    const { user, player } = userMeResponse;
    if (player) {
      const { publicId, roles } = player;
      if (roles) {
        this.roles = roles;
      }
    }
    this.requestUpdate();
  }

  private checkPatternPermission(roles: string[]) {
    const patterns = territoryPatterns.pattern ?? {};

    for (const [key, patternData] of Object.entries(patterns)) {
      const roleGroup: string[] | string | undefined = patternData.role_group;

      if (!roleGroup || (Array.isArray(roleGroup) && roleGroup.length === 0)) {
        if (roles.length === 0) {
          const reason = "You must be logged in to access this pattern.";
          this.setLockedPatterns([key], reason);
        }
        continue;
      }

      const groupList = Array.isArray(roleGroup) ? roleGroup : [roleGroup];

      const isAllowed = groupList.some((required) => roles.includes(required));

      if (!isAllowed) {
        const reason = `This pattern requires the ${groupList.join(", ")} role.`;
        this.setLockedPatterns([key], reason);
      }
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
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

  private renderTooltip(): TemplateResult | null {
    if (this.hoveredPattern && this.lockedReasons[this.hoveredPattern]) {
      return html`
        <div
          class="fixed z-[10000] px-3 py-2 rounded bg-black text-white text-sm pointer-events-none shadow-md"
          style="top: ${this.hoverPosition.y + 12}px; left: ${this.hoverPosition
            .x + 12}px;"
        >
          ${this.lockedReasons[this.hoveredPattern]}
        </div>
      `;
    }
    return null;
  }

  private renderPatternButton(
    key: string,
    pattern: (typeof territoryPatterns.pattern)[string],
  ): TemplateResult {
    const isLocked = this.isPatternLocked(key);
    // const reason = this.lockedReasons[key] || "Locked";
    return html`
      <button
        class="border p-2 rounded-lg shadow text-black dark:text-white text-left
        ${this.selectedPattern === key
          ? "bg-blue-500 text-white"
          : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"}
        ${isLocked ? "opacity-50 cursor-not-allowed" : ""}"
        style="flex: 0 1 calc(25% - 1rem); max-width: calc(25% - 1rem);"
        @click=${() => !isLocked && this.selectPattern(key)}
        @mouseenter=${(e: MouseEvent) => this.handleMouseEnter(key, e)}
        @mousemove=${(e: MouseEvent) => this.handleMouseMove(e)}
        @mouseleave=${() => this.handleMouseLeave()}
      >
        <div class="text-sm font-bold mb-1">${key}</div>
        <div
          class="preview-container"
          style="
            width: 100%;
            aspect-ratio: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #fff;
            border-radius: 8px;
            overflow: hidden;
          "
        >
          ${this.renderPatternPreview(
            pattern,
            this.buttonWidth,
            this.buttonWidth,
          )}
        </div>
      </button>
    `;
  }

  private renderPatternGrid(): TemplateResult {
    const patterns = territoryPatterns.pattern ?? {};

    const filteredPatterns = this.showChocoPattern
      ? patterns
      : Object.fromEntries(
          Object.entries(patterns).filter(([key]) => key !== "choco"),
        );

    return html`
      <div
        class="flex flex-wrap gap-4 p-2"
        style="justify-content: center; align-items: flex-start;"
      >
        <button
          class="border p-2 rounded-lg shadow text-black dark:text-white text-left
          ${this.selectedPattern === null
            ? "bg-blue-500 text-white"
            : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"}"
          style="flex: 0 1 calc(25% - 1rem); max-width: calc(25% - 1rem);"
          @click=${() => this.selectPattern(null)}
        >
          <div class="text-sm font-bold mb-1">Default</div>
          <div
            class="preview-container"
            style="
              width: 100%;
              aspect-ratio: 1;
              display: flex;
              align-items: center;
              justify-content: center;
              background: #fff;
              border-radius: 8px;
              overflow: hidden;
            "
          >
            ${this.renderBlankPreview(this.buttonWidth, this.buttonWidth)}
          </div>
        </button>
        ${Object.entries(filteredPatterns).map(([key, pattern]) =>
          this.renderPatternButton(key, pattern),
        )}
      </div>
    `;
  }

  render() {
    this.resetLockedPatterns();
    this.checkPatternPermission(this.roles);
    return html`
      ${this.renderTooltip()}
      <o-modal id="territoryPatternsModal" title="Select Territory Pattern">
        ${this.renderPatternGrid()}
      </o-modal>
    `;
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

  private selectPattern(patternKey: string | null) {
    this.selectedPattern = patternKey ?? undefined;
    setSelectedPattern(patternKey ?? "");
    if (patternKey) {
      const base64 = territoryPatterns.pattern[patternKey];
      if (base64) {
        setSelectedPatternBase64(base64.pattern);
      }
    } else {
      setSelectedPatternBase64("");
    }
    this.updatePreview();
    this.close();
  }

  private renderPatternPreview(
    pattern: (typeof territoryPatterns.pattern)[string],
    width: number,
    height: number,
  ): TemplateResult {
    const decoder = new PatternDecoder(pattern.pattern);
    const cellCountX = decoder.getTileWidth();
    const cellCountY = decoder.getTileHeight();

    const cellSize =
      cellCountX > 0 && cellCountY > 0
        ? Math.min(height / cellCountY, width / cellCountX)
        : 1;

    return html`
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: center;
          height: ${height}px;
          width: ${width}px;
          background-color: #f0f0f0;
          border-radius: 4px;
          box-sizing: border-box;
          overflow: hidden;
          position: relative;
        "
      >
        <div
          style="
            display: grid;
            grid-template-columns: repeat(${cellCountX}, ${cellSize}px);
            grid-template-rows: repeat(${cellCountY}, ${cellSize}px);
            background-color: #ccc;
            padding: 2px;
            border-radius: 4px;
          "
        >
          ${(() => {
            const tiles: TemplateResult[] = [];
            for (let py = 0; py < cellCountY; py++) {
              for (let px = 0; px < cellCountX; px++) {
                const x = px << decoder.getScale();
                const y = py << decoder.getScale();
                const bit = decoder.isSet(x, y);
                tiles.push(html`
                  <div
                    style="
                      background-color: ${bit ? "#000" : "transparent"};
                      border: 1px solid rgba(0, 0, 0, 0.1);
                      width: ${cellSize}px;
                      height: ${cellSize}px;
                      border-radius: 1px;
                    "
                  ></div>
                `);
              }
            }
            return tiles;
          })()}
        </div>
      </div>
    `;
  }

  private renderBlankPreview(width: number, height: number): TemplateResult {
    return html`
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: center;
          height: ${height}px;
          width: ${width}px;
          background-color: #ffffff;
          border-radius: 4px;
          box-sizing: border-box;
          overflow: hidden;
          position: relative;
          border: 1px solid #ccc;
        "
      >
        <div
          style="display: grid; grid-template-columns: repeat(2, ${width /
          2}px); grid-template-rows: repeat(2, ${height / 2}px);"
        >
          <div
            style="background-color: #fff; border: 1px solid rgba(0, 0, 0, 0.1); width: ${width /
            2}px; height: ${height / 2}px;"
          ></div>
          <div
            style="background-color: #fff; border: 1px solid rgba(0, 0, 0, 0.1); width: ${width /
            2}px; height: ${height / 2}px;"
          ></div>
          <div
            style="background-color: #fff; border: 1px solid rgba(0, 0, 0, 0.1); width: ${width /
            2}px; height: ${height / 2}px;"
          ></div>
          <div
            style="background-color: #fff; border: 1px solid rgba(0, 0, 0, 0.1); width: ${width /
            2}px; height: ${height / 2}px;"
          ></div>
        </div>
      </div>
    `;
  }

  private updatePreview() {
    if (!this.previewButton) return;

    const pattern = this.selectedPattern
      ? territoryPatterns.pattern[this.selectedPattern]
      : null;
    if (!pattern) {
      const blankPreview = this.renderBlankPreview(48, 48);
      render(blankPreview, this.previewButton);
      return;
    }

    const previewHTML = this.renderPatternPreview(pattern, 48, 48);
    render(previewHTML, this.previewButton);
  }

  private setLockedPatterns(lockedPatterns: string[], reason: string) {
    this.lockedPatterns = [...this.lockedPatterns, ...lockedPatterns];
    this.lockedReasons = {
      ...this.lockedReasons,
      ...lockedPatterns.reduce(
        (acc, key) => {
          acc[key] = reason;
          return acc;
        },
        {} as Record<string, string>,
      ),
    };
  }

  private resetLockedPatterns() {
    this.lockedPatterns = [];
    this.lockedReasons = {};
  }

  private isPatternLocked(patternKey: string): boolean {
    return this.lockedPatterns.includes(patternKey);
  }

  private handleMouseEnter(patternKey: string, event: MouseEvent) {
    if (this.isPatternLocked(patternKey)) {
      this.hoveredPattern = patternKey;
      this.hoverPosition = { x: event.clientX, y: event.clientY };
    }
  }

  private handleMouseMove(event: MouseEvent) {
    if (this.hoveredPattern) {
      this.hoverPosition = { x: event.clientX, y: event.clientY };
    }
  }

  private handleMouseLeave() {
    this.hoveredPattern = null;
  }
}
