import { LitElement, css, html, nothing, svg, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GameHealthState } from "../../GameHealth";
import { translateText } from "../../Utils";

type Warning = keyof GameHealthState;

const warnings = [
  ["highLatency", "high_latency"],
  ["connectionUnstable", "connection_unstable"],
  ["performance", "performance"],
] as const;

/** Match-scoped warning icons; no HUD space or input is taken when healthy. */
@customElement("game-health-indicators")
export class GameHealthIndicators extends LitElement {
  @property({ attribute: false })
  public status: GameHealthState = {
    highLatency: false,
    connectionUnstable: false,
    performance: false,
  };

  @state()
  private tooltip: Warning | null = null;
  private pinned: Warning | null = null;
  private topHudPanels: HTMLElement[] = [];

  connectedCallback(): void {
    super.connectedCallback();
    this.topHudPanels = Array.from(
      document.querySelectorAll<HTMLElement>(
        "player-info-overlay, game-left-sidebar, #game-right-hud",
      ),
    );
    window.addEventListener("resize", this.reserveTopHudSpace);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.reserveTopHudSpace);
    for (const panel of this.topHudPanels) {
      panel.style.removeProperty("--game-health-offset");
    }
    this.topHudPanels = [];
  }

  protected updated(): void {
    this.reserveTopHudSpace();
  }

  // Keep player cards, leaderboards and timer/mode readouts below warnings.
  // Only measure when warning state, tooltip or viewport size changes.
  private reserveTopHudSpace = (): void => {
    if (this.topHudPanels.length === 0) return;
    if (!Object.values(this.status).some(Boolean)) {
      for (const panel of this.topHudPanels) {
        panel.style.removeProperty("--game-health-offset");
      }
      return;
    }
    const tooltip = this.renderRoot.querySelector('[role="tooltip"]');
    const bottom = Math.max(
      this.getBoundingClientRect().bottom,
      tooltip?.getBoundingClientRect().bottom ?? 0,
    );
    for (const panel of this.topHudPanels) {
      panel.style.setProperty(
        "--game-health-offset",
        `${Math.ceil(bottom) + 8}px`,
      );
    }
  };

  static styles = css`
    :host {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 8px);
      left: 50%;
      transform: translateX(-50%);
      z-index: 800;
      pointer-events: none;
      font:
        13px/1.4 system-ui,
        sans-serif;
    }
    .warnings {
      display: flex;
      gap: 2px;
    }
    button {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 1px solid #fbbf2455;
      border-radius: 8px;
      background: #111827d9;
      color: #fbbf24;
      cursor: help;
      pointer-events: auto;
      touch-action: manipulation;
    }
    button:focus-visible {
      outline: 2px solid white;
      outline-offset: 2px;
    }
    svg {
      width: 22px;
      height: 22px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    [role="tooltip"] {
      position: absolute;
      top: 50px;
      left: 50%;
      transform: translateX(-50%);
      width: max-content;
      max-width: min(260px, calc(100vw - 24px));
      padding: 8px 12px;
      border-radius: 6px;
      background: #111827f2;
      color: white;
      text-align: center;
    }
  `;

  public clear(): void {
    this.status = {
      highLatency: false,
      connectionUnstable: false,
      performance: false,
    };
    this.tooltip = null;
    this.pinned = null;
  }

  protected willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("status") && this.tooltip && !this.status[this.tooltip]) {
      this.tooltip = null;
      this.pinned = null;
    }
  }

  private show(warning: Warning): void {
    this.tooltip = warning;
  }

  private hide(): void {
    this.tooltip = this.pinned;
  }

  private toggle(warning: Warning): void {
    this.pinned = this.pinned === warning ? null : warning;
    this.tooltip = this.pinned;
  }

  private icon(warning: Warning) {
    const paths =
      warning === "highLatency"
        ? svg`<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6m-3 0v3"/>`
        : warning === "connectionUnstable"
          ? svg`<path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0m-9 4a5 5 0 0 1 6 0M12 20h.01M3 3l18 18"/>`
          : svg`<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8m-4-4v4m0-14v4m0 3h.01"/>`;
    return html`<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  }

  render() {
    const active = warnings.filter(([warning]) => this.status[warning]);
    const tooltip = active.find(([warning]) => warning === this.tooltip);
    return html`
      <div class="warnings">
        ${active.map(
          ([warning, key]) => html`
            <button
              type="button"
              data-warning=${warning}
              aria-label=${translateText(`game_health.${key}`)}
              aria-describedby=${
                tooltip?.[0] === warning ? "game-health-tooltip" : nothing
              }
              @mouseenter=${() => this.show(warning)}
              @mouseleave=${() => this.hide()}
              @focus=${() => this.show(warning)}
              @blur=${() => {
                this.pinned = null;
                this.tooltip = null;
              }}
              @click=${() => this.toggle(warning)}
              @keydown=${(event: KeyboardEvent) => {
                // Keep native button activation local to this control.
                if (
                  event.key === "Enter" ||
                  event.key === " " ||
                  event.code === "Space"
                ) {
                  event.stopPropagation();
                }
                if (event.key === "Escape") {
                  this.pinned = null;
                  this.tooltip = null;
                }
              }}
              @keyup=${(event: KeyboardEvent) => {
                if (event.key === " " || event.code === "Space") {
                  event.stopPropagation();
                }
              }}
            >
              ${this.icon(warning)}
            </button>
          `,
        )}
      </div>
      ${
        tooltip
          ? html`<div id="game-health-tooltip" role="tooltip">
              ${translateText(`game_health.${tooltip[1]}_description`)}
            </div>`
          : nothing
      }
    `;
  }
}
