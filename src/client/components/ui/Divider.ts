import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("ui-divider")
export class Divider extends LitElement {
  @property({ type: String })
  spacing: "sm" | "md" | "lg" = "md";

  @property({ type: String })
  color: string = "";

  createRenderRoot() {
    return this;
  }

  render() {
    const spacingClasses = {
      sm: "my-0.5",
      md: "my-1",
      lg: "my-2",
    };

    const colorClass = this.color || "bg-zinc-700/80";

    return html`<div
      class="${spacingClasses[this.spacing]} h-px ${colorClass}"
    ></div>`;
  }
}
