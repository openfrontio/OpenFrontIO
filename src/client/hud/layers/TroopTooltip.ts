import { renderTroops } from "@openfront/engine-lib/Format";
import { html, LitElement, render as litRender } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";
import "../../components/OfIcon";

const TOOLTIP =
  "fixed z-9400 hud-modal rounded-lg px-3 py-2 pointer-events-none text-white animate-hud-rise motion-reduce:animate-none";

const TITLE = "text-xs font-medium text-white/70";
const COUNT = "text-lg font-bold tabular-nums";
const PERCENTAGE = "text-xs text-white/60";

const GAP_PX = 12;
const EDGE_PX = 8;

@customElement("troop-tooltip")
export class TroopTooltip extends LitElement {
  @property({ type: Number }) troops = 0;
  @property({ type: Number }) percentage = 0;
  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;
  @property({ type: Boolean }) visible = false;

  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  disconnectedCallback() {
    this.removePortal();
    super.disconnectedCallback();
  }

  protected updated() {
    if (!this.visible) {
      this.removePortal();
      return;
    }

    if (this.portal === null) {
      this.portal = document.createElement("div");
      document.body.appendChild(this.portal);
    }

    litRender(
      html`
        <div class=${TOOLTIP} role="tooltip">
          <div class=${TITLE}>${translateText("control_panel.troops_to_send")}</div>
          <div class=${COUNT}>
            <of-icon name="sword" size="16"></of-icon>
            ${renderTroops(this.troops)}
          </div>
          <div class=${PERCENTAGE}>${this.percentage}%</div>
        </div>
      `,
      this.portal,
    );

    const box = this.portal.firstElementChild as HTMLElement;

    const left = Math.max(
      EDGE_PX,
      Math.min(this.x + GAP_PX, window.innerWidth - EDGE_PX - box.offsetWidth),
    );

    const top = Math.max(
      EDGE_PX,
      Math.min(
        this.y + GAP_PX,
        window.innerHeight - EDGE_PX - box.offsetHeight,
      ),
    );

    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  private removePortal() {
    this.portal?.remove();
    this.portal = null;
  }
}
