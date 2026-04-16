import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { Cell } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent } from "../../InputHandler";
import { renderTroops } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
const shieldIcon = assetUrl("images/ShieldIconWhite.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");

export function troopAttackColor(
  attackerTroops: number,
  defenderTroops: number,
): string {
  return attackerTroops > defenderTroops ? "#66ff66" : "#ffbe3c";
}

export function troopDefenceColor(
  attackerTroops: number,
  myTroops: number,
): string {
  return attackerTroops > myTroops ? "#ff4444" : "#ff9944";
}

// An attack can have multiple disconnected front-line segments, so elements
// and positions are parallel arrays with one entry per segment.
interface AttackLabel {
  elements: HTMLDivElement[];
  positions: (Cell | null)[];
  isIncoming: boolean;
  attackerTroops: number;
  defenderTroops: number;
}

export class AttackingTroopsOverlay implements Layer {
  private container: HTMLDivElement;
  private labelTemplate: HTMLDivElement;
  private labels = new Map<string, AttackLabel>();
  // Guard against queuing multiple worker requests in the same tick window.
  private inFlightRequest = false;
  private isVisible = true;
  private onAlternateView: (e: AlternateViewEvent) => void;

  constructor(
    private readonly game: GameView,
    private readonly transformHandler: TransformHandler,
    private readonly eventBus: EventBus,
    private readonly userSettings: UserSettings,
  ) {}

  shouldTransform(): boolean {
    return false;
  }

  init() {
    this.container = document.createElement("div");
    this.container.style.position = "fixed";
    this.container.style.left = "50%";
    this.container.style.top = "50%";
    this.container.style.pointerEvents = "none";
    // z-index 4 places labels above NameLayer (z-index 3).
    this.container.style.zIndex = "4";
    document.body.appendChild(this.container);

    this.labelTemplate = this.createLabelTemplate();

    this.onAlternateView = (e) => {
      this.isVisible = !e.alternateView;
      this.container.style.display = this.isVisible ? "" : "none";
    };
    this.eventBus.on(AlternateViewEvent, this.onAlternateView);
  }

  destroy() {
    if (!this.container) return;
    this.clearAllLabels();
    this.container.remove();
    this.eventBus.off(AlternateViewEvent, this.onAlternateView);
  }

  getTickIntervalMs() {
    return 200;
  }

  tick() {
    if (!this.userSettings.attackingTroopsOverlay() || !this.isVisible) {
      if (this.labels.size > 0) this.clearAllLabels();
      return;
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      this.clearAllLabels();
      return;
    }

    const activeIDs = new Set<string>();

    // Outgoing attacks — green if winning, amber if losing.
    for (const attack of myPlayer.outgoingAttacks()) {
      activeIDs.add(attack.id);
      if (!attack.targetID) {
        this.removeLabel(attack.id);
        continue;
      }
      const defender = this.game.playerBySmallID(attack.targetID);
      if (!defender || !defender.isPlayer()) {
        this.removeLabel(attack.id);
        continue;
      }
      this.ensureLabel(attack.id, attack.troops, defender.troops(), false);
    }

    // Incoming attacks — red if the attacker outnumbers the player, orange otherwise.
    for (const attack of myPlayer.incomingAttacks()) {
      activeIDs.add(attack.id);
      const attacker = this.game.playerBySmallID(attack.attackerID);
      if (!attacker || !attacker.isPlayer()) {
        this.removeLabel(attack.id);
        continue;
      }
      this.ensureLabel(attack.id, attack.troops, myPlayer.troops(), true);
    }

    for (const [id] of this.labels) {
      if (!activeIDs.has(id)) this.removeLabel(id);
    }

    // Single worker request per tick; skip if the previous one is still in flight.
    if (this.inFlightRequest) return;
    this.inFlightRequest = true;

    void myPlayer
      .attackClusteredPositions()
      .then((attacks) => {
        for (const { id, positions } of attacks) {
          const lbl = this.labels.get(id);
          if (!lbl) continue;
          this.reconcileLabelPositions(lbl, positions);
        }
      })
      .catch(() => {
        // On error, hide all labels until the next successful response.
        for (const lbl of this.labels.values()) lbl.positions.fill(null);
      })
      .finally(() => {
        this.inFlightRequest = false;
      });
  }

  private ensureLabel(
    attackID: string,
    attackerTroops: number,
    defenderTroops: number,
    isIncoming: boolean,
  ) {
    let label = this.labels.get(attackID);
    if (!label) {
      label = {
        elements: [],
        positions: [],
        isIncoming,
        attackerTroops,
        defenderTroops,
      };
      this.labels.set(attackID, label);
    } else {
      label.attackerTroops = attackerTroops;
      label.defenderTroops = defenderTroops;
    }
    for (const el of label.elements) {
      this.updateLabelContent(el, attackerTroops, defenderTroops, isIncoming);
    }
  }

  renderLayer(_context: CanvasRenderingContext2D) {
    const screenPosOld = this.transformHandler.worldToScreenCoordinates(
      new Cell(0, 0),
    );
    const screenPos = new Cell(
      screenPosOld.x - window.innerWidth / 2,
      screenPosOld.y - window.innerHeight / 2,
    );
    this.container.style.transform = `translate(${screenPos.x}px, ${screenPos.y}px) scale(${this.transformHandler.scale})`;

    for (const label of this.labels.values()) {
      for (let i = 0; i < label.elements.length; i++) {
        const el = label.elements[i];
        const pos = label.positions[i];

        if (!pos || !this.transformHandler.isOnScreen(pos)) {
          el.style.display = "none";
          continue;
        }

        el.style.display = "inline-flex";
        // Centre the label on its world position and counter-scale so text
        // stays the same screen size regardless of zoom level.
        el.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) scale(${1 / this.transformHandler.scale})`;
      }
    }
  }

  private reconcileLabelPositions(lbl: AttackLabel, positions: Cell[]) {
    // Add elements for new clusters.
    while (lbl.elements.length < positions.length) {
      lbl.elements.push(
        this.createLabelElement(
          lbl.attackerTroops,
          lbl.defenderTroops,
          lbl.isIncoming,
        ),
      );
      lbl.positions.push(null);
    }

    // Remove elements for clusters that no longer exist.
    while (lbl.elements.length > positions.length) {
      lbl.elements.pop()!.remove();
      lbl.positions.pop();
    }

    // Snap large jumps instantly; let the CSS transition handle small advances.
    for (let i = 0; i < positions.length; i++) {
      const old = lbl.positions[i];
      const next = positions[i];
      if (old && Math.hypot(next.x - old.x, next.y - old.y) > 50) {
        const el = lbl.elements[i];
        el.style.transition = "none";
        el.style.transform = `translate(${next.x}px, ${next.y}px) translate(-50%, -50%) scale(${1 / this.transformHandler.scale})`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 0.2s ease-out";
        });
      }
      lbl.positions[i] = next;
    }
  }

  private createLabelTemplate(): HTMLDivElement {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.display = "none";
    el.style.alignItems = "center";
    el.style.gap = "3px";
    el.style.whiteSpace = "nowrap";
    el.style.fontSize = "11px";
    el.style.fontWeight = "bold";
    el.style.padding = "1px 4px";
    el.style.borderRadius = "3px";
    el.style.backgroundColor = "rgba(0,0,0,0.55)";
    el.style.pointerEvents = "none";
    el.style.lineHeight = "1.3";
    el.style.transition = "transform 0.2s ease-out";
    el.style.width = "max-content";
    const icon = document.createElement("img");
    icon.style.width = "10px";
    icon.style.height = "10px";
    el.appendChild(icon);
    const span = document.createElement("span");
    span.style.minWidth = "25px";
    el.appendChild(span);
    return el;
  }

  private createLabelElement(
    attackerTroops: number,
    defenderTroops: number,
    isIncoming: boolean,
  ): HTMLDivElement {
    const el = this.labelTemplate.cloneNode(true) as HTMLDivElement;
    el.style.fontFamily = this.game.config().theme().font();
    this.updateLabelContent(el, attackerTroops, defenderTroops, isIncoming);
    this.container.appendChild(el);
    return el;
  }

  private updateLabelContent(
    el: HTMLDivElement,
    attackerTroops: number,
    defenderTroops: number,
    isIncoming: boolean,
  ) {
    const icon = el.children[0] as HTMLImageElement;
    const span = el.children[1] as HTMLSpanElement;
    if (isIncoming) {
      icon.src = shieldIcon;
      span.style.color = troopDefenceColor(attackerTroops, defenderTroops);
      span.textContent = renderTroops(attackerTroops);
    } else {
      icon.src = swordIcon;
      span.style.color = troopAttackColor(attackerTroops, defenderTroops);
      span.textContent = renderTroops(attackerTroops);
    }
  }

  private removeLabel(attackID: string) {
    const label = this.labels.get(attackID);
    if (!label) return;
    for (const el of label.elements) el.remove();
    this.labels.delete(attackID);
  }

  private clearAllLabels() {
    for (const label of this.labels.values()) {
      for (const el of label.elements) el.remove();
    }
    this.labels.clear();
  }
}
