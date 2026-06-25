import { html, TemplateResult } from "lit";
import { TrailEffect } from "../../core/CosmeticSchemas";

// A flowing spectrum used for the "rainbow" effect preview. The in-game shader
// animates the hue over time; the swatch shows the full spectrum at rest.
const RAINBOW_GRADIENT =
  "linear-gradient(90deg,#ff0000,#ff8a00,#ffe600,#28c76f,#00a8ff,#7d5fff,#ff0000)";

/**
 * Render a swatch preview of a transport-trail effect, filling its container.
 * Mirrors the shader: solid = flat color, pulse = same color pulsing, rainbow =
 * the full spectrum.
 */
export function renderTrailSwatch(effect: TrailEffect): TemplateResult {
  if (effect.type === "rainbow") {
    return html`<div
      class="w-full h-full rounded-md"
      style="background:${RAINBOW_GRADIENT};"
    ></div>`;
  }
  if (effect.type === "gradient") {
    return html`<div
      class="w-full h-full rounded-md"
      style="background:linear-gradient(90deg,${effect.color},${effect.color2});"
    ></div>`;
  }
  const pulseClass = effect.type === "pulse" ? "animate-pulse" : "";
  return html`<div
    class="w-full h-full rounded-md ${pulseClass}"
    style="background:${effect.color};"
  ></div>`;
}
