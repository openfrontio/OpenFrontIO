import { html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { TransportShipTrailAttributes } from "../../core/CosmeticSchemas";

// Neutral fallback when a trail has no usable colors.
const EMPTY_BG = "#444";

/**
 * Swatch preview of a transport-ship-trail effect, filling its container.
 *
 * - gradient / single color: a static swatch (flat color or left-to-right
 *   gradient — a multi-color list reads as a rainbow).
 * - transition: cross-fades through the colors over time, mirroring the trail
 *   (each color step lasts 1/frequency seconds, matching the shader).
 */
@customElement("trail-swatch")
export class TrailSwatch extends LitElement {
  // Named `trail` (not `attributes`) to avoid clashing with Element.attributes.
  @property({ attribute: false })
  trail: TransportShipTrailAttributes | null = null;

  private animation: Animation | null = null;

  // Light DOM so the shared Tailwind classes apply.
  createRenderRoot(): HTMLElement {
    return this;
  }

  render(): TemplateResult {
    const colors = this.trail?.colors ?? [];
    let background: string;
    if (colors.length === 0) {
      background = EMPTY_BG;
    } else if (this.trail?.type === "transition") {
      // The animation (see updated) cross-fades from here through the list.
      background = colors[0];
    } else if (colors.length === 1) {
      background = colors[0];
    } else {
      background = `linear-gradient(90deg,${colors.join(",")})`;
    }
    return html`<div
      class="w-full h-full rounded-md"
      style="background:${background};"
    ></div>`;
  }

  updated(changed: Map<string, unknown>): void {
    if (!changed.has("trail")) return;
    this.animation?.cancel();
    this.animation = null;

    const attrs = this.trail;
    if (attrs?.type !== "transition") return;
    const colors = attrs.colors;
    if (colors.length < 2 || attrs.frequency <= 0) return;

    const fill = this.querySelector<HTMLElement>("div");
    if (!fill) return;

    // Cross-fade color0 → color1 → … → color0; each step lasts 1/frequency s,
    // matching the shader's i = floor(uTime * frequency) mod count.
    const keyframes = [...colors, colors[0]].map((c) => ({
      backgroundColor: c,
    }));
    this.animation = fill.animate(keyframes, {
      duration: (colors.length / attrs.frequency) * 1000,
      iterations: Infinity,
      easing: "linear",
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.animation?.cancel();
    this.animation = null;
  }
}

/** Render a transport-ship-trail swatch (animated for the transition style). */
export function renderTransportShipTrailSwatch(
  attributes: TransportShipTrailAttributes,
): TemplateResult {
  // block + full size so the inner swatch fills the host (custom elements are
  // inline by default, which would collapse the inner w-full/h-full).
  return html`<trail-swatch
    class="block w-full h-full"
    .trail=${attributes}
  ></trail-swatch>`;
}
