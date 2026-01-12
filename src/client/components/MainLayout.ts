import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("main-layout")
export class MainLayout extends LitElement {
  private _initialChildren: Node[] = [];

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    if (this._initialChildren.length === 0 && this.childNodes.length > 0) {
      this._initialChildren = Array.from(this.childNodes);
    }
    super.connectedCallback();
  }

  render() {
    return html`
      <main
        class="relative [.in-game_&]:hidden flex flex-col flex-1 overflow-hidden w-full px-[clamp(1.5rem,3vw,3rem)] pt-[clamp(0.75rem,1.5vw,1.5rem)] pb-[clamp(0.75rem,1.5vw,1.5rem)]"
      >
        <div
          class="w-full max-w-[20cm] mx-auto flex flex-col flex-1 gap-[clamp(1.5rem,3vw,3rem)] overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden lg:[scrollbar-width:auto] lg:[-ms-overflow-style:auto] lg:[&::-webkit-scrollbar]:block"
        >
          ${this._initialChildren}
        </div>
      </main>
    `;
  }
}
