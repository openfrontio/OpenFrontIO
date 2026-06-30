import { html, TemplateResult } from "lit";
import { TransportShipTrailAttributes } from "../../core/CosmeticSchemas";

// Neutral fallback when a trail has no usable colors.
const EMPTY_BG = "#444";

/**
 * Render a swatch preview of a transport-ship-trail's attributes, filling its
 * container. A trail is a list of colors: one color renders as a flat swatch,
 * two or more as a left-to-right gradient (a multi-color list reads as a
 * rainbow). An empty list renders a neutral swatch.
 */
export function renderTransportShipTrailSwatch(
  attributes: TransportShipTrailAttributes,
): TemplateResult {
  const colors = attributes.colors;
  const background =
    colors.length === 0
      ? EMPTY_BG
      : colors.length === 1
        ? colors[0]
        : `linear-gradient(90deg,${colors.join(",")})`;
  return html`<div
    class="w-full h-full rounded-md"
    style="background:${background};"
  ></div>`;
}
