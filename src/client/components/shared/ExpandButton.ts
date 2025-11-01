import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";

@customElement("expand-button")
export class ExpandButton extends LitElement {
  @property({ type: Boolean }) expanded = false;

  private onClick = () => {
    const next = !this.expanded;
    this.dispatchEvent(
      new CustomEvent("toggle", {
        detail: { value: next },
        bubbles: true,
        composed: true,
      }),
    );
  };

  createRenderRoot() {
    return this;
  }

  render() {
    const label = this.expanded
      ? (translateText("common.collapse_panel") ?? "Collapse panel")
      : (translateText("common.expand_panel") ?? "Expand panel");

    return html`
      <button
        class="h-10 px-3 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
        @click=${this.onClick}
        aria-pressed=${String(this.expanded)}
        aria-label=${label}
        title=${label}
        type="button"
      >
        ${this.expanded ? "⤡" : "⤢"}
        <span class="hidden sm:inline">${label}</span>
      </button>
    `;
  }
}
