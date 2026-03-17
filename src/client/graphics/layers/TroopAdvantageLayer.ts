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

// One label element per disconnected cluster of front-line tiles
interface AttackLabel {
  elements: HTMLDivElement[];
  positions: (Cell | null)[];
  isIncoming: boolean;
  attackerTroops: number;
  defenderTroops: number;
}

export class TroopAdvantageLayer implements Layer {
  private container: HTMLDivElement;
  private labels = new Map<string, AttackLabel>();
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
    if (!this.userSettings.troopAdvantageLayer() || !this.isVisible) {
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

    // Remove labels for attacks that no longer exist
    for (const [id] of this.labels) {
      if (!activeIDs.has(id)) this.removeLabel(id);
    }

    const myTroops = myPlayer.troops();

    // Outgoing attacks — ⚔ green if winning, amber if losing
    for (const attack of outgoing) {
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

    // Incoming attacks — red if attacker > my troops, orange if attacker < my troops
    for (const attack of incoming) {
      const attacker = this.game.playerBySmallID(attack.attackerID);
      if (!attacker || !attacker.isPlayer()) {
        this.removeLabel(attack.id);
        continue;
      }
      this.ensureLabel(attack.id, attack.troops, myTroops, true);
    }

    // Single request per tick for all attack cluster positions
    if (this.inFlightRequest) return;
    this.inFlightRequest = true;

    void myPlayer
      .attackClusterPositions(myPlayer.smallID())
      .then((attacks) => {
        for (const { id, clusters } of attacks) {
          const lbl = this.labels.get(id);
          if (!lbl) continue;

          while (lbl.elements.length < clusters.length) {
            lbl.elements.push(
              this.createLabelElement(
                lbl.attackerTroops,
                lbl.defenderTroops,
                lbl.isIncoming,
              ),
            );
            lbl.positions.push(null);
          }
          while (lbl.elements.length > clusters.length) {
            lbl.elements.pop()!.remove();
            lbl.positions.pop();
          }

          for (let i = 0; i < clusters.length; i++) {
            lbl.positions[i] = clusters[i];
          }
        }
      })
      .catch(() => {
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
        el.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) scale(${1 / this.transformHandler.scale})`;
      }
    }
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
