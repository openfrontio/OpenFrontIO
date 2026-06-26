import { html, TemplateResult } from "lit";
import { TransportShipTrailAttributes } from "../../core/CosmeticSchemas";

// A flowing spectrum used for the "rainbow" transport-ship-trail preview.
const RAINBOW_GRADIENT =
  "linear-gradient(90deg,#ff0000,#ff8a00,#ffe600,#28c76f,#00a8ff,#7d5fff,#ff0000)";

/**
 * Render a swatch preview of a transport-ship-trail's attributes, filling its
 * container: solid = flat color, pulse = same color pulsing, rainbow = full
 * spectrum, gradient = two-color blend.
 */
export function renderTransportShipTrailSwatch(
  attributes: TransportShipTrailAttributes,
): TemplateResult {
  if (attributes.type === "rainbow") {
    return html`<div
      class="w-full h-full rounded-md"
      style="background:${RAINBOW_GRADIENT};"
    ></div>`;
  }
  if (attributes.type === "gradient") {
    return html`<div
      class="w-full h-full rounded-md"
      style="background:linear-gradient(90deg,${attributes.color},${attributes.color2});"
    ></div>`;
  }
  const pulseClass = attributes.type === "pulse" ? "animate-pulse" : "";
  return html`<div
    class="w-full h-full rounded-md ${pulseClass}"
    style="background:${attributes.color};"
  ></div>`;
}
