import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  TERRITORY_RENDERER_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../../core/game/UserSettings";
import { Layer } from "./Layer";
import {
  TERRITORY_RENDERER_OPTIONS,
  TERRITORY_RENDERER_STATUS_EVENT,
  TerritoryRendererId,
  TerritoryRendererPreference,
  TerritoryRendererStatus,
} from "./TerritoryBackend";

@customElement("renderer-status-panel")
export class RendererStatusPanel extends LitElement implements Layer {
  @property({ type: Object })
  public userSettings!: UserSettings;

  @state()
  private activeRenderer: TerritoryRendererId | null = null;

  @state()
  private preference: TerritoryRendererPreference = "auto";

  @state()
  private failedBackends: TerritoryRendererId[] = [];

  @state()
  private message: string | null = null;

  @state()
  private position: { x: number; y: number } | null = null;

  @state()
  private isDragging = false;

  private dragState: {
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null = null;

  private readonly positionStorageKey = "rendererStatusPanel.position.v1";

  static styles = css`
    .panel {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 9998;
      width: min(280px, calc(100vw - 32px));
      box-sizing: border-box;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      background: rgba(13, 16, 20, 0.86);
      color: rgba(255, 255, 255, 0.92);
      font-family:
        Inter,
        ui-sans-serif,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      font-size: 12px;
      line-height: 1.35;
      pointer-events: auto;
      user-select: none;
      box-shadow: 0 14px 32px rgba(0, 0, 0, 0.24);
      backdrop-filter: blur(10px);
    }

    .panel.dragging {
      opacity: 0.72;
    }

    .title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px 6px;
      cursor: grab;
      touch-action: none;
      font-weight: 700;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .titleActions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    button {
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.9);
      padding: 4px 7px;
      font: inherit;
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.16);
    }

    button:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .panel.dragging .title {
      cursor: grabbing;
    }

    .body {
      display: grid;
      gap: 7px;
      padding: 8px 10px 10px;
    }

    .row {
      display: grid;
      grid-template-columns: 72px 1fr;
      align-items: center;
      gap: 8px;
    }

    .label {
      color: rgba(255, 255, 255, 0.62);
    }

    .value {
      min-width: 0;
      color: rgba(255, 255, 255, 0.94);
      font-weight: 650;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .active {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: rgb(67, 214, 142);
      box-shadow: 0 0 0 3px rgba(67, 214, 142, 0.16);
    }

    select {
      width: 100%;
      min-width: 0;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.38);
      color: rgba(255, 255, 255, 0.94);
      padding: 5px 7px;
      font: inherit;
      outline: none;
    }

    .note {
      color: rgba(255, 255, 255, 0.66);
      overflow-wrap: anywhere;
    }
  `;

  init() {
    this.preference = this.userSettings.territoryRenderer();
    this.restorePosition();
    globalThis.addEventListener(
      TERRITORY_RENDERER_STATUS_EVENT,
      this.handleRendererStatus,
    );
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${TERRITORY_RENDERER_KEY}`,
      this.handlePreferenceChanged,
    );
    this.requestUpdate();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.endDrag();
    globalThis.removeEventListener(
      TERRITORY_RENDERER_STATUS_EVENT,
      this.handleRendererStatus,
    );
    globalThis.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${TERRITORY_RENDERER_KEY}`,
      this.handlePreferenceChanged,
    );
  }

  private readonly handleRendererStatus = (event: Event) => {
    const detail = (event as CustomEvent<TerritoryRendererStatus>).detail;
    if (!detail) {
      return;
    }

    this.activeRenderer = detail.active;
    this.preference = detail.preference;
    this.failedBackends = detail.failedBackends;
    this.message = detail.message;
  };

  private readonly handlePreferenceChanged = () => {
    if (!this.userSettings) {
      return;
    }
    this.preference = this.userSettings.territoryRenderer();
    this.message = null;
  };

  private changeRenderer(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this.userSettings.setTerritoryRenderer(value);
    this.preference = this.userSettings.territoryRenderer();
  }

  private rendererSettingsTarget(): "webgl" | "webgpu" | null {
    if (this.activeRenderer === "webgl" || this.activeRenderer === "webgpu") {
      return this.activeRenderer;
    }
    if (
      this.activeRenderer === null &&
      (this.preference === "webgl" || this.preference === "webgpu")
    ) {
      return this.preference;
    }
    return null;
  }

  private openRendererSettings(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const renderer = this.rendererSettingsTarget();
    if (renderer === "webgl") {
      this.userSettings.setWebgpuDebug(false);
      this.userSettings.setWebglDebug(true);
    } else if (renderer === "webgpu") {
      this.userSettings.setWebglDebug(false);
      this.userSettings.setWebgpuDebug(true);
    }
  }

  private rendererLabel(id: TerritoryRendererId | TerritoryRendererPreference) {
    if (id === "webgpu") return "WebGPU";
    if (id === "webgl") return "WebGL";
    if (id === "classic") return "Classic";
    return "Auto";
  }

  private statusNote() {
    if (this.failedBackends.length > 0) {
      return `Skipped this cycle: ${this.failedBackends
        .map((id) => this.rendererLabel(id))
        .join(", ")}`;
    }
    if (
      this.activeRenderer &&
      this.preference !== "auto" &&
      this.activeRenderer !== this.preference
    ) {
      return `Fallback from ${this.rendererLabel(this.preference)}`;
    }
    return this.message;
  }

  private restorePosition() {
    try {
      const raw = localStorage.getItem(this.positionStorageKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as { x: unknown; y: unknown };
      if (
        typeof parsed.x === "number" &&
        typeof parsed.y === "number" &&
        Number.isFinite(parsed.x) &&
        Number.isFinite(parsed.y)
      ) {
        this.position = this.clampPosition(parsed.x, parsed.y);
      }
    } catch {
      // Keep the default docked position.
    }
  }

  private savePosition() {
    if (!this.position) {
      return;
    }
    try {
      localStorage.setItem(
        this.positionStorageKey,
        JSON.stringify(this.position),
      );
    } catch {
      // Position persistence is best-effort.
    }
  }

  private clampPosition(x: number, y: number) {
    const panel = this.renderRoot.querySelector(".panel") as HTMLElement | null;
    const width = panel?.offsetWidth ?? 280;
    const height = panel?.offsetHeight ?? 120;
    const margin = 8;
    return {
      x: Math.max(margin, Math.min(window.innerWidth - width - margin, x)),
      y: Math.max(margin, Math.min(window.innerHeight - height - margin, y)),
    };
  }

  private panelStyle() {
    if (!this.position) {
      return "";
    }
    return `left: ${this.position.x}px; top: ${this.position.y}px; bottom: auto;`;
  }

  private stopPointerEvent(event: PointerEvent) {
    event.stopPropagation();
  }

  private handleDragPointerDown(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();

    const panel = this.renderRoot.querySelector(".panel") as HTMLElement | null;
    if (!panel) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    this.position = { x: rect.left, y: rect.top };
    this.isDragging = true;
    this.dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };

    globalThis.addEventListener("pointermove", this.handleDragPointerMove);
    globalThis.addEventListener("pointerup", this.handleDragPointerUp);
    globalThis.addEventListener("pointercancel", this.handleDragPointerUp);
  }

  private readonly handleDragPointerMove = (event: PointerEvent) => {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.position = this.clampPosition(
      event.clientX - this.dragState.offsetX,
      event.clientY - this.dragState.offsetY,
    );
  };

  private readonly handleDragPointerUp = (event: PointerEvent) => {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.savePosition();
    this.endDrag();
  };

  private endDrag() {
    globalThis.removeEventListener("pointermove", this.handleDragPointerMove);
    globalThis.removeEventListener("pointerup", this.handleDragPointerUp);
    globalThis.removeEventListener("pointercancel", this.handleDragPointerUp);
    this.dragState = null;
    this.isDragging = false;
  }

  render() {
    if (!this.userSettings) {
      return null;
    }

    const note = this.statusNote();
    const canOpenSettings = this.rendererSettingsTarget() !== null;
    return html`
      <div
        class="panel ${this.isDragging ? "dragging" : ""}"
        style=${this.panelStyle()}
        @pointerdown=${this.stopPointerEvent}
      >
        <div class="title" @pointerdown=${this.handleDragPointerDown}>
          <span>Renderer</span>
          <div class="titleActions">
            <button
              type="button"
              ?disabled=${!canOpenSettings}
              @pointerdown=${this.stopPointerEvent}
              @click=${this.openRendererSettings}
            >
              settings
            </button>
          </div>
        </div>
        <div class="body">
          <div class="row">
            <div class="label">Active</div>
            <div class="value active">
              <span class="dot"></span>
              ${this.activeRenderer
                ? this.rendererLabel(this.activeRenderer)
                : "Pending"}
            </div>
          </div>
          <div class="row">
            <label class="label" for="renderer-select">Saved</label>
            <select
              id="renderer-select"
              .value=${this.preference}
              @change=${this.changeRenderer}
            >
              ${TERRITORY_RENDERER_OPTIONS.map(
                (option) =>
                  html`<option value=${option}>
                    ${this.rendererLabel(option)}
                  </option>`,
              )}
            </select>
          </div>
          ${note ? html`<div class="note">${note}</div>` : null}
        </div>
      </div>
    `;
  }
}
