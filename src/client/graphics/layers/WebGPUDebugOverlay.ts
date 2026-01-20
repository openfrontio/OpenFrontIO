import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { EventBus } from "../../../core/EventBus";
import { UserSettings } from "../../../core/game/UserSettings";
import { WebGPUComputeMetricsEvent } from "../../InputHandler";
import {
  TERRAIN_SHADER_KEY,
  TERRAIN_SHADERS,
  terrainShaderIdFromInt,
  terrainShaderIntFromId,
  TerrainShaderOption,
} from "../webgpu/render/TerrainShaderRegistry";
import {
  TERRITORY_POST_SMOOTHING,
  TERRITORY_POST_SMOOTHING_KEY,
  territoryPostSmoothingIdFromInt,
  territoryPostSmoothingIntFromId,
} from "../webgpu/render/TerritoryPostSmoothingRegistry";
import {
  TERRITORY_PRE_SMOOTHING,
  TERRITORY_PRE_SMOOTHING_KEY,
  territoryPreSmoothingIdFromInt,
  territoryPreSmoothingIntFromId,
} from "../webgpu/render/TerritoryPreSmoothingRegistry";
import {
  TERRITORY_SHADER_KEY,
  TERRITORY_SHADERS,
  territoryShaderIdFromInt,
  territoryShaderIntFromId,
  TerritoryShaderOption,
} from "../webgpu/render/TerritoryShaderRegistry";
import { Layer } from "./Layer";

type ShaderOption = TerrainShaderOption | TerritoryShaderOption;

@customElement("webgpu-debug-overlay")
export class WebGPUDebugOverlay extends LitElement implements Layer {
  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public userSettings!: UserSettings;

  @state()
  private renderFps: number = 0;

  @state()
  private tickComputeMs: number = 0;

  private frameTimes: number[] = [];

  static styles = css`
    .overlay {
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 9999;
      min-width: 340px;
      max-width: 420px;
      background: rgba(0, 0, 0, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 10px 12px;
      color: rgba(255, 255, 255, 0.92);
      font-family:
        ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
        "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      pointer-events: auto;
      user-select: none;
    }

    .title {
      font-weight: 700;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 10px;
      margin-bottom: 10px;
    }

    .metric {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      white-space: nowrap;
    }

    .label {
      color: rgba(255, 255, 255, 0.7);
    }

    .value {
      color: rgba(255, 255, 255, 0.95);
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 6px 0;
      user-select: none;
    }

    .sectionTitle {
      margin-top: 10px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: rgba(255, 255, 255, 0.85);
      text-transform: uppercase;
      font-size: 11px;
    }

    select,
    input[type="range"] {
      width: 170px;
    }

    select {
      background: rgba(0, 0, 0, 0.6);
      color: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      padding: 4px 6px;
      font-size: 12px;
    }

    input[type="checkbox"] {
      transform: translateY(1px);
    }

    .range {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 10px;
    }

    .rangeValue {
      min-width: 54px;
      text-align: right;
      color: rgba(255, 255, 255, 0.8);
      font-variant-numeric: tabular-nums;
    }
  `;

  init() {
    this.eventBus.on(WebGPUComputeMetricsEvent, (e) => {
      if (typeof e.computeMs === "number" && Number.isFinite(e.computeMs)) {
        this.tickComputeMs = e.computeMs;
        this.requestUpdate();
      }
    });
    this.requestUpdate();
  }

  updateFrameMetrics(frameDurationMs: number): void {
    if (!this.userSettings || !this.userSettings.webgpuDebug()) {
      return;
    }

    if (!Number.isFinite(frameDurationMs) || frameDurationMs <= 0) {
      return;
    }

    this.frameTimes.push(frameDurationMs);
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    const avgMs =
      this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.renderFps = Math.round(1000 / Math.max(1e-6, avgMs));
    this.requestUpdate();
  }

  private selectedShaderId() {
    const selected = this.userSettings.getInt(TERRITORY_SHADER_KEY, 0);
    return territoryShaderIdFromInt(selected);
  }

  private setSelectedShaderId(id: "classic" | "retro") {
    this.userSettings.setInt(
      TERRITORY_SHADER_KEY,
      territoryShaderIntFromId(id),
    );
    this.requestUpdate();
  }

  private selectedTerrainShaderId() {
    const selected = this.userSettings.getInt(TERRAIN_SHADER_KEY, 0);
    return terrainShaderIdFromInt(selected);
  }

  private setSelectedTerrainShaderId(
    id: "classic" | "improved-lite" | "improved-heavy",
  ) {
    this.userSettings.setInt(TERRAIN_SHADER_KEY, terrainShaderIntFromId(id));
    this.requestUpdate();
  }

  private selectedPreSmoothingId() {
    const selected = this.userSettings.getInt(TERRITORY_PRE_SMOOTHING_KEY, 0);
    return territoryPreSmoothingIdFromInt(selected);
  }

  private setSelectedPreSmoothingId(id: "off" | "dissolve" | "budget") {
    this.userSettings.setInt(
      TERRITORY_PRE_SMOOTHING_KEY,
      territoryPreSmoothingIntFromId(id),
    );
    this.requestUpdate();
  }

  private selectedPostSmoothingId() {
    const selected = this.userSettings.getInt(TERRITORY_POST_SMOOTHING_KEY, 0);
    return territoryPostSmoothingIdFromInt(selected);
  }

  private setSelectedPostSmoothingId(id: "off" | "fade" | "dissolve") {
    this.userSettings.setInt(
      TERRITORY_POST_SMOOTHING_KEY,
      territoryPostSmoothingIntFromId(id),
    );
    this.requestUpdate();
  }

  private renderOptionControl(option: ShaderOption) {
    if (option.kind === "boolean") {
      const enabled = this.userSettings.get(option.key, option.defaultValue);
      return html`
        <div class="row">
          <div class="label">${option.label}</div>
          <input
            type="checkbox"
            .checked=${live(enabled)}
            @change=${(e: Event) => {
              const checked = (e.target as HTMLInputElement).checked;
              this.userSettings.set(option.key, checked);
              this.requestUpdate();
            }}
          />
        </div>
      `;
    }

    if (option.kind === "enum") {
      const value = this.userSettings.getInt(option.key, option.defaultValue);
      return html`
        <div class="row">
          <div class="label">${option.label}</div>
          <select
            .value=${live(String(value))}
            @change=${(e: Event) => {
              const raw = (e.target as HTMLSelectElement).value;
              const next = Number.parseInt(raw, 10);
              if (!Number.isFinite(next)) return;
              this.userSettings.setInt(option.key, next);
              this.requestUpdate();
            }}
          >
            ${option.options.map(
              (o) => html`<option value=${String(o.value)}>${o.label}</option>`,
            )}
          </select>
        </div>
      `;
    }

    const value = this.userSettings.getFloat(option.key, option.defaultValue);
    return html`
      <div class="row">
        <div class="label">${option.label}</div>
        <div class="range">
          <input
            type="range"
            min=${String(option.min)}
            max=${String(option.max)}
            step=${String(option.step)}
            .value=${live(String(value))}
            @input=${(e: Event) => {
              const raw = (e.target as HTMLInputElement).value;
              const next = Number.parseFloat(raw);
              if (!Number.isFinite(next)) return;
              this.userSettings.setFloat(option.key, next);
              this.requestUpdate();
            }}
          />
          <div class="rangeValue">${value.toFixed(2)}</div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.userSettings || !this.userSettings.webgpuDebug()) {
      return null;
    }

    const shaderId = this.selectedShaderId();
    const shader =
      TERRITORY_SHADERS.find((s) => s.id === shaderId) ?? TERRITORY_SHADERS[0];
    const terrainShaderId = this.selectedTerrainShaderId();
    const terrainShader =
      TERRAIN_SHADERS.find((s) => s.id === terrainShaderId) ??
      TERRAIN_SHADERS[0];
    const preId = this.selectedPreSmoothingId();
    const pre =
      TERRITORY_PRE_SMOOTHING.find((s) => s.id === preId) ??
      TERRITORY_PRE_SMOOTHING[0];
    const postId = this.selectedPostSmoothingId();
    const post =
      TERRITORY_POST_SMOOTHING.find((s) => s.id === postId) ??
      TERRITORY_POST_SMOOTHING[0];

    return html`
      <div class="overlay">
        <div class="title">
          <div>WebGPU Debug</div>
        </div>

        <div class="metrics">
          <div class="metric">
            <div class="label">tick ms compute</div>
            <div class="value">${this.tickComputeMs.toFixed(2)}</div>
          </div>
          <div class="metric">
            <div class="label">render fps</div>
            <div class="value">${this.renderFps}</div>
          </div>
        </div>

        <div class="sectionTitle">Shaders</div>

        <div class="row">
          <div class="label">Terrain Shader</div>
          <select
            .value=${live(String(terrainShaderIntFromId(terrainShaderId)))}
            @change=${(e: Event) => {
              const raw = (e.target as HTMLSelectElement).value;
              const next = terrainShaderIdFromInt(Number.parseInt(raw, 10));
              this.setSelectedTerrainShaderId(next);
            }}
          >
            ${TERRAIN_SHADERS.map(
              (s) =>
                html`<option value=${String(terrainShaderIntFromId(s.id))}>
                  ${s.label}
                </option>`,
            )}
          </select>
        </div>

        ${terrainShader.options.map((opt) => this.renderOptionControl(opt))}

        <div class="sectionTitle">Territory</div>

        <div class="row">
          <div class="label">Territory Shader</div>
          <select
            .value=${live(String(territoryShaderIntFromId(shaderId)))}
            @change=${(e: Event) => {
              const raw = (e.target as HTMLSelectElement).value;
              const next = territoryShaderIdFromInt(Number.parseInt(raw, 10));
              this.setSelectedShaderId(next);
            }}
          >
            ${TERRITORY_SHADERS.map(
              (s) =>
                html`<option value=${String(territoryShaderIntFromId(s.id))}>
                  ${s.label}
                </option>`,
            )}
          </select>
        </div>

        ${shader.options.map((opt) => this.renderOptionControl(opt))}

        <div class="sectionTitle">Temporal</div>

        <div class="row">
          <div class="label">Post Compute</div>
          <select
            .value=${live(String(territoryPreSmoothingIntFromId(preId)))}
            @change=${(e: Event) => {
              const raw = (e.target as HTMLSelectElement).value;
              const next = territoryPreSmoothingIdFromInt(
                Number.parseInt(raw, 10),
              );
              this.setSelectedPreSmoothingId(next);
            }}
          >
            ${TERRITORY_PRE_SMOOTHING.map(
              (s) =>
                html`<option
                  value=${String(territoryPreSmoothingIntFromId(s.id))}
                >
                  ${s.label}
                </option>`,
            )}
          </select>
        </div>

        ${pre.options.map((opt) => this.renderOptionControl(opt))}

        <div class="row">
          <div class="label">Post Render</div>
          <select
            .value=${live(String(territoryPostSmoothingIntFromId(postId)))}
            @change=${(e: Event) => {
              const raw = (e.target as HTMLSelectElement).value;
              const next = territoryPostSmoothingIdFromInt(
                Number.parseInt(raw, 10),
              );
              this.setSelectedPostSmoothingId(next);
            }}
          >
            ${TERRITORY_POST_SMOOTHING.map(
              (s) =>
                html`<option
                  value=${String(territoryPostSmoothingIntFromId(s.id))}
                >
                  ${s.label}
                </option>`,
            )}
          </select>
        </div>

        ${post.options.map((opt) => this.renderOptionControl(opt))}
      </div>
    `;
  }
}
