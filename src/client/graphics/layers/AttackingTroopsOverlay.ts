import { EventBus } from "../../../core/EventBus";
import { Cell } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent } from "../../InputHandler";
import { renderTroops } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

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
    // The container is anchored at the viewport centre (50%, 50%) so that
    // label transforms can use raw world coordinates without an extra offset.
    this.container = document.createElement("div");
    this.container.style.position = "fixed";
    this.container.style.left = "50%";
    this.container.style.top = "50%";
    this.container.style.pointerEvents = "none";
    // z-index 4 places labels above NameLayer (z-index 3).
    this.container.style.zIndex = "4";
    document.body.appendChild(this.container);

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

    const outgoing = myPlayer.outgoingAttacks();
    const incoming = myPlayer.incomingAttacks();
    const activeIDs = new Set([
      ...outgoing.map((a) => a.id),
      ...incoming.map((a) => a.id),
    ]);

    for (const [id] of this.labels) {
      if (!activeIDs.has(id)) this.removeLabel(id);
    }

    const myTroops = myPlayer.troops();

    // Outgoing attacks — green if winning, amber if losing.
    for (const attack of outgoing) {
      // targetID === 0 means the attack is targeting sea/empty tiles; skip it.
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

    // Incoming attacks — red if the attacker outnumbers my troops, orange otherwise.
    for (const attack of incoming) {
      const attacker = this.game.playerBySmallID(attack.attackerID);
      if (!attacker || !attacker.isPlayer()) {
        this.removeLabel(attack.id);
        continue;
      }
      this.ensureLabel(attack.id, attack.troops, myTroops, true);
    }

    // Single worker request per tick; skip if the previous one is still in flight.
    if (this.inFlightRequest) return;
    this.inFlightRequest = true;

    void myPlayer
      .attackFrontLinePositions()
      .then((attacks) => {
        for (const { id, centers } of attacks) {
          const lbl = this.labels.get(id);
          if (!lbl) continue;
          this.reconcileLabelPositions(lbl, centers);
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

        el.style.display = "block";
        // Centre the label on its world position and counter-scale so text
        // stays the same screen size regardless of zoom level.
        el.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) scale(${1 / this.transformHandler.scale})`;
      }
    }
  }

  // Assign each existing label element to the new center closest to its current
  // position (greedy nearest-neighbour matching). This prevents labels from
  // swapping front-line segments when their relative sizes change between ticks,
  // which would otherwise cause visible jumping.
  private reconcileLabelPositions(lbl: AttackLabel, centers: Cell[]) {
    const availableCenterIndexes = centers.map((_, i) => i);
    const updatedPositions: (Cell | null)[] = [];

    for (
      let elementIndex = 0;
      elementIndex < lbl.elements.length && availableCenterIndexes.length > 0;
      elementIndex++
    ) {
      const currentPos = lbl.positions[elementIndex];
      if (!currentPos) {
        // Element has no position yet — assign the first available center.
        updatedPositions.push(centers[availableCenterIndexes.shift()!]);
        continue;
      }

      // Find the available center closest to this element's current position.
      let closestCenterAt = 0;
      let closestDistance = Infinity;
      for (let i = 0; i < availableCenterIndexes.length; i++) {
        const candidate = centers[availableCenterIndexes[i]];
        const dx = candidate.x - currentPos.x;
        const dy = candidate.y - currentPos.y;
        const squaredDistance = dx * dx + dy * dy;
        if (squaredDistance < closestDistance) {
          closestDistance = squaredDistance;
          closestCenterAt = i;
        }
      }
      updatedPositions.push(
        centers[availableCenterIndexes.splice(closestCenterAt, 1)[0]],
      );
    }

    // Create new label elements for centers that had no existing element to match.
    for (const centerIndex of availableCenterIndexes) {
      lbl.elements.push(
        this.createLabelElement(
          lbl.attackerTroops,
          lbl.defenderTroops,
          lbl.isIncoming,
        ),
      );
      updatedPositions.push(centers[centerIndex]);
    }

    // Remove elements for front-line segments that no longer exist.
    while (lbl.elements.length > updatedPositions.length) {
      lbl.elements.pop()!.remove();
    }

    lbl.positions = updatedPositions;
  }

  private createLabelElement(
    attackerTroops: number,
    defenderTroops: number,
    isIncoming: boolean,
  ): HTMLDivElement {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.display = "none";
    el.style.whiteSpace = "nowrap";
    el.style.fontSize = "11px";
    el.style.fontWeight = "bold";
    el.style.fontFamily = this.game.config().theme().font();
    el.style.padding = "1px 4px";
    el.style.borderRadius = "3px";
    el.style.backgroundColor = "rgba(0,0,0,0.55)";
    el.style.pointerEvents = "none";
    el.style.lineHeight = "1.3";
    // Smooth the label to its new position as the front line advances.
    el.style.transition = "transform 0.2s ease-out";
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
    const span = document.createElement("span");
    if (isIncoming) {
      const icon = document.createElement("span");
      icon.textContent = "🛡 ";
      span.style.color = troopDefenceColor(attackerTroops, defenderTroops);
      span.textContent = renderTroops(attackerTroops);
      el.replaceChildren(icon, span);
    } else {
      span.style.color = troopAttackColor(attackerTroops, defenderTroops);
      span.textContent = `⚔ ${renderTroops(attackerTroops)}`;
      el.replaceChildren(span);
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
