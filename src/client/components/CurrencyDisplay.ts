import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";
import "./CapIcon";
import "./PlutoniumIcon";

// Player wallets arrive as numbers (CurrencyBalancesSchema coerces them), clan
// treasuries as decimal bigint strings (ClanInfoSchema) that can exceed
// Number.MAX_SAFE_INTEGER — so strings are parsed with BigInt, never Number.
// Returns null when there is no amount to show (absent, or unparseable), which
// the renderer treats as "hide this side" rather than "zero". Note BigInt("")
// is 0n, hence the falsy guard on the string branch.
export function formatCurrencyAmount(
  value: number | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString() : null;
  }
  if (!value) return null;
  try {
    return BigInt(value).toLocaleString();
  } catch {
    return null;
  }
}

@customElement("currency-display")
export class CurrencyDisplay extends LitElement {
  // Not attributes: these accept bigint strings as well as numbers, and are
  // always set via property binding.
  @property({ attribute: false })
  hard: number | string | null = null;

  @property({ attribute: false })
  soft: number | string | null = null;

  createRenderRoot() {
    return this;
  }

  render() {
    const hard = formatCurrencyAmount(this.hard);
    const soft = formatCurrencyAmount(this.soft);
    if (hard === null && soft === null) return html``;

    return html`
      <div class="flex gap-3 justify-center">
        ${hard === null
          ? ""
          : html`<div
              class="flex items-center gap-1.5"
              title=${translateText("cosmetics.hard")}
            >
              <plutonium-icon .size=${16}></plutonium-icon>
              <span class="text-sm font-bold text-green-400">${hard}</span>
            </div>`}
        ${soft === null
          ? ""
          : html`<div
              class="flex items-center gap-1.5"
              title=${translateText("cosmetics.soft")}
            >
              <cap-icon .size=${20} style="margin-top:3px"></cap-icon>
              <span class="text-sm font-bold text-amber-700">${soft}</span>
            </div>`}
      </div>
    `;
  }
}
