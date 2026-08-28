import { base64url } from "jose";
import { html, LitElement, nothing, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  Effect,
  isNukeExplosionEffect,
  NukeExplosionAttributes,
  Pattern,
  Skin,
} from "../../../core/CosmeticSchemas";
import { decodePatternData } from "../../../core/PatternDecoder";
import { ResolvedCosmetic } from "../../Cosmetics";
import {
  CosmeticPreviewConfig,
  CosmeticPreviewRenderer,
} from "../../render/preview/CosmeticPreviewRenderer";
import {
  UT_ATOM_BOMB,
  UT_CITY,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_TRANSPORT,
  UT_WARSHIP,
} from "../../render/types/UnitType";
import { translateText } from "../../Utils";
import { attributesToExplosionParams } from "../../WebGLFrameBuilder";

/**
 * CosmeticRenderCanvas — Lit component hosting the live WebGL2 preview viewport.
 *
 * Capabilities:
 * - Manages WebGL context lifecycle and continuous rendering loop.
 * - Smooth pointer drag panning (with button click filtering) and scroll wheel zoom.
 * - On-screen D-Pad, Reset Center button, keyboard WASD/Arrow navigation.
 * - Interactive single / 5-nuke salvo mode toggle for atom bomb explosions.
 */
@customElement("cosmetic-render-canvas")
export class CosmeticRenderCanvas extends LitElement {
  @property({ attribute: false })
  resolved!: ResolvedCosmetic;

  @property({ attribute: false })
  customColors: string[] | null = null;

  @property({ attribute: false })
  salvoEnabled = false;

  @state()
  private hasError = false;

  private renderer: CosmeticPreviewRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private rafId: number | null = null;

  private autoZoomStartTime: number | null = null;
  private isAutoZooming = false;
  private targetZoom = 1.0;

  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  createRenderRoot() {
    return this;
  }

  firstUpdated() {
    this.canvas = this.querySelector<HTMLCanvasElement>("canvas");
    if (!this.canvas) return;

    try {
      this.renderer = new CosmeticPreviewRenderer(this.canvas);
      this.applyCosmetic();
      this.startLoop();
    } catch (e) {
      console.error("Failed to init cosmetic preview renderer:", e);
      this.hasError = true;
    }
  }

  updated(changedProps: PropertyValues) {
    super.updated(changedProps);
    if (changedProps.has("resolved") && this.renderer) {
      this.applyCosmetic();
    } else if (changedProps.has("customColors") && this.renderer) {
      if (this.customColors && this.customColors.length > 0) {
        this.renderer.setPreviewColors(this.customColors);
      } else {
        this.applyCosmetic(); // back to the catalog colors
      }
    }
    if (changedProps.has("salvoEnabled") && this.renderer) {
      this.renderer.setSalvoMode(this.salvoEnabled);
    }
  }

  disconnectedCallback() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
    super.disconnectedCallback();
  }

  private startLoop(): void {
    const loop = (now: number) => {
      if (this.isAutoZooming && this.autoZoomStartTime && this.renderer) {
        const elapsed = (now - this.autoZoomStartTime) / 1000;
        const progress = Math.min(1.0, elapsed / 2.5);
        const ease =
          progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        this.renderer.zoomTo(1.0 + ease * (this.targetZoom - 1.0));
        if (progress >= 1.0) {
          this.isAutoZooming = false;
        }
      }

      this.renderer?.render(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private applyCosmetic(): void {
    if (!this.renderer || !this.resolved) return;
    const config = this.buildPreviewConfig(this.resolved);
    if (this.customColors && this.customColors.length > 0) {
      config.effectColors = this.customColors;
    }
    config.salvoMode = this.salvoEnabled;
    this.renderer.setCosmetic(config);

    if (config.mode === "SKIN") {
      const isSmall = this.checkIsSmallSkin(this.resolved);
      if (isSmall) {
        this.targetZoom = 2.2;
        this.autoZoomStartTime = performance.now();
        this.isAutoZooming = true;
      } else {
        this.targetZoom = 1.0;
        this.isAutoZooming = false;
        this.renderer.zoomTo(1.0);
      }
    } else {
      this.isAutoZooming = false;
    }
  }

  private checkIsSmallSkin(resolved: ResolvedCosmetic): boolean {
    if (resolved.type === "pattern") {
      const pattern = resolved.cosmetic as Pattern;
      if (pattern?.pattern) {
        try {
          const { width, height, scale } = decodePatternData(
            pattern.pattern,
            base64url.decode,
          );
          const scaledW = width << scale;
          const scaledH = height << scale;
          return scaledW <= 64 && scaledH <= 64;
        } catch {
          return true;
        }
      }
      return true;
    }
    // Big PNG skins show full island
    return false;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if ((event.target as HTMLElement).closest("button, input, label")) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    this.isDragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.isAutoZooming = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.isDragging || !this.renderer) return;
    const dx = event.clientX - this.dragStartX;
    const dy = event.clientY - this.dragStartY;
    const zoom = this.renderer.zoom;
    this.renderer.pan(-dx / zoom, -dy / zoom);
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.isDragging) return;
    this.isDragging = false;
    const target = event.currentTarget as HTMLElement;
    if (target?.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.isAutoZooming = false;
    if (!this.renderer || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.15 : 0.87;
    this.renderer.zoomAtScreen(factor, screenX, screenY);
  };

  private handleZoomIn = (event: MouseEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    this.isAutoZooming = false;
    this.renderer?.zoomBy(1.25);
  };

  private handleZoomOut = (event: MouseEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    this.isAutoZooming = false;
    this.renderer?.zoomBy(0.8);
  };

  private panUp = (e: MouseEvent): void => this.pan(0, -1, e);
  private panDown = (e: MouseEvent): void => this.pan(0, 1, e);
  private panLeft = (e: MouseEvent): void => this.pan(-1, 0, e);
  private panRight = (e: MouseEvent): void => this.pan(1, 0, e);

  private pan(dx: number, dy: number, e: MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    this.isAutoZooming = false;
    const zoom = this.renderer?.zoom ?? 1.0;
    this.renderer?.pan((dx * 40) / zoom, (dy * 40) / zoom);
  }

  private handleResetCenter = (e: MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    this.isAutoZooming = false;
    this.renderer?.resetCamera();
  };

  private handleToggleSalvo = (e: MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    this.salvoEnabled = !this.salvoEnabled;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.renderer) return;
    const zoom = this.renderer.zoom;
    const step = 40 / zoom;
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      this.isAutoZooming = false;
      this.renderer.pan(0, -step);
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      this.isAutoZooming = false;
      this.renderer.pan(0, step);
      e.preventDefault();
    } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      this.isAutoZooming = false;
      this.renderer.pan(-step, 0);
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      this.isAutoZooming = false;
      this.renderer.pan(step, 0);
      e.preventDefault();
    }
  };

  private buildPreviewConfig(
    resolved: ResolvedCosmetic,
  ): CosmeticPreviewConfig {
    if (resolved.type === "skin") {
      const skin = resolved.cosmetic as Skin;
      return { mode: "SKIN", skinUrl: skin?.url };
    }
    if (resolved.type === "pattern") {
      const pattern = resolved.cosmetic as Pattern;
      const colors = resolved.colorPalette
        ? [
            resolved.colorPalette.primaryColor,
            resolved.colorPalette.secondaryColor,
          ]
        : ["#3b82f6", "#1d4ed8"];
      return {
        mode: "SKIN",
        patternData: pattern?.pattern,
        effectColors: colors,
      };
    }
    if (resolved.type === "effect") {
      return this.buildEffectConfig(resolved.cosmetic as Effect, resolved.key);
    }
    return { mode: "NUKE_MISSILE_TRAIL" };
  }

  private buildEffectConfig(
    effect: Effect | null,
    key: string,
  ): CosmeticPreviewConfig {
    if (!effect) return { mode: "NUKE_MISSILE_TRAIL" };

    const isMirv = Boolean(
      key.toLowerCase().includes("mirv") ||
      (effect.name && effect.name.toLowerCase().includes("mirv")),
    );

    // Palette-rendered effects hand their catalog attributes straight to the
    // renderer, which packs them exactly as the game does.
    if (effect.effectType === "nukeTrail") {
      return {
        mode: isMirv ? "MIRV_CLUSTER" : "NUKE_MISSILE_TRAIL",
        effectAttributes: effect.attributes,
      };
    }
    if (effect.effectType === "transportShipTrail") {
      return {
        mode: "WARSHIP_BOAT_TRAIL",
        cosmeticUnitType: UT_TRANSPORT,
        effectAttributes: effect.attributes,
      };
    }
    if (effect.effectType === "warship") {
      return {
        mode: "WARSHIP_BOAT_TRAIL",
        cosmeticUnitType: UT_WARSHIP,
        effectAttributes: effect.attributes,
      };
    }
    if (effect.effectType === "train" || effect.effectType === "railroad") {
      // Same rail scene; the mode picks which effect-palette block lights up.
      return {
        mode: effect.effectType === "train" ? "TRAIN" : "RAILROAD",
        effectAttributes: effect.attributes,
      };
    }
    if (effect.effectType === "structures") {
      return {
        mode: "BUILDING",
        cosmeticUnitType: UT_CITY,
        structureLevel: 2,
        effectAttributes: effect.attributes,
      };
    }
    if (isNukeExplosionEffect(effect)) {
      const attrs = effect.attributes as NukeExplosionAttributes;
      const nukeType = attrs.nukeType;
      const explosionParams = attributesToExplosionParams(attrs);

      return {
        mode:
          nukeType === "mirvWarhead" || isMirv
            ? "MIRV_CLUSTER"
            : "NUKE_EXPLOSION",
        cosmeticUnitType:
          nukeType === "hydro"
            ? UT_HYDROGEN_BOMB
            : nukeType === "mirvWarhead"
              ? UT_MIRV
              : UT_ATOM_BOMB,
        explosionParams,
      };
    }
    return { mode: "NUKE_MISSILE_TRAIL" };
  }

  private isAtomBombExplosion(): boolean {
    if (!this.resolved || this.resolved.type !== "effect") return false;
    const effect = this.resolved.cosmetic as Effect;
    if (!effect || !isNukeExplosionEffect(effect)) return false;
    const attrs = effect.attributes as NukeExplosionAttributes;
    return attrs.nukeType === "atom";
  }

  render() {
    if (this.hasError) {
      return html`<div
        class="relative flex h-full min-h-[340px] w-full items-center justify-center rounded-xl bg-zinc-950 p-6 text-center text-sm font-semibold text-white/70 border border-white/10"
      >
        ${translateText("store.preview_error")}
      </div>`;
    }

    return html`<div
      data-cosmetic-render-host
      class="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-zinc-950 border border-white/10 select-none cursor-grab active:cursor-grabbing focus:outline-hidden"
      tabindex="0"
      @pointerdown=${this.handlePointerDown}
      @pointermove=${this.handlePointerMove}
      @pointerup=${this.handlePointerUp}
      @pointercancel=${this.handlePointerUp}
      @wheel=${this.handleWheel}
      @keydown=${this.handleKeyDown}
    >
      <canvas class="block h-full w-full pointer-events-none"></canvas>

      <!-- Salvo Mode Toggle for Atom Bomb -->
      ${this.isAtomBombExplosion()
        ? html`
            <div
              class="absolute top-3 left-3 z-20 select-none pointer-events-auto"
            >
              <button
                type="button"
                aria-label=${translateText("store.preview_salvo_toggle")}
                title=${translateText("store.preview_salvo_toggle")}
                @click=${this.handleToggleSalvo}
                class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 backdrop-blur-md border border-white/20 text-xs font-bold text-white hover:bg-zinc-800 transition active:scale-95 shadow-lg cursor-pointer"
              >
                <span
                  class="inline-block w-2 h-2 rounded-full ${this.salvoEnabled
                    ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse"
                    : "bg-zinc-500"}"
                ></span>
                <span
                  >${translateText("store.preview_salvo_count", {
                    count: this.salvoEnabled ? 5 : 1,
                  })}</span
                >
              </button>
            </div>
          `
        : nothing}

      <!-- On-screen Navigation & Zoom Controls -->
      <div
        class="absolute bottom-3 right-3 flex flex-col items-center gap-2 z-20 select-none pointer-events-auto"
      >
        <!-- Directional D-Pad -->
        <div
          class="grid grid-cols-3 gap-1 p-1 rounded-xl bg-zinc-900/90 backdrop-blur-md border border-white/20 shadow-xl"
        >
          <div></div>
          <button
            type="button"
            aria-label=${translateText("user_setting.move_up")}
            title=${translateText("user_setting.move_up")}
            @click=${this.panUp}
            class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 text-white/90 transition active:scale-90 cursor-pointer"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.5"
                d="M5 15l7-7 7 7"
              ></path>
            </svg>
          </button>
          <div></div>

          <button
            type="button"
            aria-label=${translateText("user_setting.move_left")}
            title=${translateText("user_setting.move_left")}
            @click=${this.panLeft}
            class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 text-white/90 transition active:scale-90 cursor-pointer"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.5"
                d="M15 19l-7-7 7-7"
              ></path>
            </svg>
          </button>
          <button
            type="button"
            aria-label=${translateText("user_setting.reset")}
            title=${translateText("user_setting.reset")}
            @click=${this.handleResetCenter}
            class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-cyan-600 text-white transition active:scale-90 cursor-pointer text-[10px] font-black"
          >
            •
          </button>
          <button
            type="button"
            aria-label=${translateText("user_setting.move_right")}
            title=${translateText("user_setting.move_right")}
            @click=${this.panRight}
            class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 text-white/90 transition active:scale-90 cursor-pointer"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.5"
                d="M9 5l7 7-7 7"
              ></path>
            </svg>
          </button>

          <div></div>
          <button
            type="button"
            aria-label=${translateText("user_setting.move_down")}
            title=${translateText("user_setting.move_down")}
            @click=${this.panDown}
            class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 text-white/90 transition active:scale-90 cursor-pointer"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.5"
                d="M19 9l-7 7-7-7"
              ></path>
            </svg>
          </button>
          <div></div>
        </div>

        <!-- Zoom Controls (+ / -) -->
        <div
          class="flex flex-col gap-1 p-1 rounded-xl bg-zinc-900/90 backdrop-blur-md border border-white/20 shadow-xl"
        >
          <button
            type="button"
            aria-label=${translateText("user_setting.zoom_in")}
            title=${translateText("user_setting.zoom_in")}
            @click=${this.handleZoomIn}
            class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 text-white/90 transition active:scale-90 cursor-pointer text-sm font-bold"
          >
            +
          </button>
          <button
            type="button"
            aria-label=${translateText("user_setting.zoom_out")}
            title=${translateText("user_setting.zoom_out")}
            @click=${this.handleZoomOut}
            class="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 text-white/90 transition active:scale-90 cursor-pointer text-sm font-bold"
          >
            −
          </button>
        </div>
      </div>
    </div>`;
  }
}
