import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

export type DividerSpacing = "sm" | "md" | "lg";
@customElement("ui-divider")
export class Divider extends LitElement {
  @property({ type: String })
  spacing: DividerSpacing = "md";

  @property({ type: String })
  color: string = "bg-zinc-700/80";

  createRenderRoot() {
    return this;
  }

  render() {
    const spacingClasses: Record<DividerSpacing, string> = {
      sm: "my-0.5",
      md: "my-1",
      lg: "my-2",
    } as const;
    const spacing = spacingClasses[this.spacing] ?? spacingClasses.md;

    const colorClass = this.color || "bg-zinc-700/80";

    return html`<div
      role="separator"
      aria-hidden="true"
      class="${spacing} h-px ${colorClass}"
    ></div>`;
  }
}
