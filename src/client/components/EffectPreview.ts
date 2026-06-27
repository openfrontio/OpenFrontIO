import { html, TemplateResult } from "lit";
import { TransportShipTrailAttributes } from "../../core/CosmeticSchemas";

// A flowing spectrum used for the "rainbow" transport-ship-trail preview.
const RAINBOW_GRADIENT =
  "linear-gradient(90deg,#ff0000,#ff8a00,#ffe600,#28c76f,#00a8ff,#7d5fff,#ff0000)";

// Neutral fallback for attribute types we don't recognize.
const UNKNOWN_BG = "#444";

/**
 * Render a swatch preview of a transport-ship-trail's attributes, filling its
 * container: solid = flat color, pulse = same color pulsing, rainbow = full
 * spectrum, gradient = two-color blend. Unknown attribute types render a neutral
 * swatch (we ignore types we don't know about).
 */
export function renderTransportShipTrailSwatch(
  attributes: TransportShipTrailAttributes,
): TemplateResult {
  const color = attributes.color ?? UNKNOWN_BG;
  switch (attributes.type) {
    case "rainbow":
      return html`<div
        class="w-full h-full rounded-md"
        style="background:${RAINBOW_GRADIENT};"
      ></div>`;
    case "gradient":
      return html`<div
        class="w-full h-full rounded-md"
        style="background:linear-gradient(90deg,${color},${attributes.color2 ??
        color});"
      ></div>`;
    case "pulse":
      return html`<div
        class="w-full h-full rounded-md animate-pulse"
        style="background:${color};"
      ></div>`;
    case "solid":
      return html`<div
        class="w-full h-full rounded-md"
        style="background:${color};"
      ></div>`;
    default:
      // Unknown attribute type — neutral swatch.
      return html`<div
        class="w-full h-full rounded-md"
        style="background:${UNKNOWN_BG};"
      ></div>`;
  }
}
