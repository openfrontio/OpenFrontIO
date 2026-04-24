import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { Layer } from "./Layer";

interface TechNode {
  id: string;
  name: string;
  description: string;
  cost: number;
  requires?: string;
}

const TECH_NODES: TechNode[] = [
  {
    id: "better_equipment",
    name: "Better Equipment",
    description: "+5% offensive attack strength (visual buff).",
    cost: 500_000,
  },
  {
    id: "efficient_logistics",
    name: "Efficient Logistics",
    description: "+10% trade ship yield (visual buff).",
    cost: 1_000_000,
    requires: "better_equipment",
  },
  {
    id: "nuclear_physics",
    name: "Nuclear Physics",
    description: "-10% nuke cost (visual buff).",
    cost: 2_500_000,
    requires: "efficient_logistics",
  },
  {
    id: "advanced_radar",
    name: "Advanced Radar",
    description: "+20% SAM detection range (visual buff).",
    cost: 5_000_000,
    requires: "nuclear_physics",
  },
];

@customElement("tech-tree-panel")
export class TechTreeLayer extends LitElement implements Layer {
  public game: GameView;
  public userSettings: UserSettings = new UserSettings();

  @state()
  private open = false;

  @state()
  private researched: string[] = [];

  static styles = css`
    :host {
      position: fixed;
      top: 60px;
      right: 10px;
      z-index: 50;
      font-family: sans-serif;
    }
    .toggle {
      background: rgba(40, 40, 80, 0.9);
      color: white;
      border: 1px solid #667;
      padding: 6px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .toggle:hover {
      background: rgba(60, 60, 120, 0.9);
    }
    .panel {
      margin-top: 6px;
      background: rgba(20, 20, 30, 0.92);
      color: white;
      border: 1px solid #445;
      border-radius: 6px;
      padding: 10px;
      width: 280px;
      max-height: 70vh;
      overflow-y: auto;
    }
    .node {
      border: 1px solid #334;
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 6px;
      background: rgba(40, 40, 60, 0.6);
    }
    .node.researched {
      border-color: #4c9;
      background: rgba(30, 70, 50, 0.6);
    }
    .node.locked {
      opacity: 0.5;
    }
    .node .name {
      font-weight: bold;
      font-size: 13px;
    }
    .node .desc {
      font-size: 11px;
      color: #bbc;
      margin: 4px 0;
    }
    .node .cost {
      font-size: 11px;
      color: #dd8;
    }
    .node button {
      margin-top: 4px;
      background: #357;
      color: white;
      border: 0;
      padding: 4px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
    }
    .node button:disabled {
      background: #333;
      cursor: not-allowed;
    }
    .header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: bold;
    }
    .reset {
      background: #733;
      color: white;
      border: 0;
      padding: 3px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
    }
  `;

  init() {
    this.researched = this.userSettings.researchedTechs();
  }

  tick() {
    // Periodically refresh in case state changed elsewhere
    if (this.open) {
      this.researched = this.userSettings.researchedTechs();
    }
  }

  private togglePanel() {
    this.open = !this.open;
    if (this.open) {
      this.researched = this.userSettings.researchedTechs();
    }
  }

  private canResearch(node: TechNode): boolean {
    if (this.researched.includes(node.id)) return false;
    if (node.requires && !this.researched.includes(node.requires)) return false;
    const me = this.game?.myPlayer?.();
    if (me === null || me === undefined) return false;
    return Number(me.gold()) >= node.cost;
  }

  private research(node: TechNode) {
    if (!this.canResearch(node)) return;
    this.userSettings.addTech(node.id);
    this.researched = this.userSettings.researchedTechs();
  }

  private resetAll() {
    this.userSettings.resetTechs();
    this.researched = [];
  }

  render() {
    const me = this.game?.myPlayer?.();
    if (!me) return html``;

    return html`
      <button class="toggle" @click=${this.togglePanel}>
        🔬 Research
        ${this.researched.length > 0 ? `(${this.researched.length})` : ""}
      </button>
      ${this.open
        ? html`
            <div class="panel">
              <div class="header">
                <span>Tech Tree</span>
                <button class="reset" @click=${this.resetAll}>Reset</button>
              </div>
              ${TECH_NODES.map((node) => {
                const isResearched = this.researched.includes(node.id);
                const isLocked =
                  node.requires !== undefined &&
                  !this.researched.includes(node.requires);
                const canBuy = this.canResearch(node);
                const classes = isResearched
                  ? "node researched"
                  : isLocked
                    ? "node locked"
                    : "node";
                return html`
                  <div class=${classes}>
                    <div class="name">
                      ${isResearched ? "✓ " : ""}${node.name}
                    </div>
                    <div class="desc">${node.description}</div>
                    <div class="cost">
                      Cost: ${node.cost.toLocaleString()}g
                      ${node.requires
                        ? html` · Requires:
                          ${TECH_NODES.find((t) => t.id === node.requires)
                            ?.name ?? node.requires}`
                        : ""}
                    </div>
                    ${!isResearched
                      ? html`
                          <button
                            ?disabled=${!canBuy}
                            @click=${() => this.research(node)}
                          >
                            ${isLocked ? "Locked" : "Research"}
                          </button>
                        `
                      : ""}
                  </div>
                `;
              })}
            </div>
          `
        : ""}
    `;
  }
}
