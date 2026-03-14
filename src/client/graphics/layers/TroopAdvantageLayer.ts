import { EventBus } from "../../../core/EventBus";
import { Cell } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent } from "../../InputHandler";
import { renderTroops } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

interface AttackLabel {
  attackID: string;
  element: HTMLDivElement;
  position: Cell | null;
}

export class TroopAdvantageLayer implements Layer {
  private container: HTMLDivElement;
  private labels = new Map<string, AttackLabel>();
  private inFlightPositionRequests = new Set<string>();
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
    this.container.style.zIndex = "2";
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
    if (!this.userSettings.troopAdvantageLayer()) {
      this.clearAllLabels();
      return;
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      this.clearAllLabels();
      return;
    }

    const attacks = myPlayer.outgoingAttacks();
    const activeIDs = new Set(attacks.map((a) => a.id));

    // Remove labels for attacks that no longer exist
    for (const [id, label] of this.labels) {
      if (!activeIDs.has(id)) {
        label.element.remove();
        this.labels.delete(id);
        this.inFlightPositionRequests.delete(id);
      }
    }

    // Update or create labels for active attacks
    for (const attack of attacks) {
      // Skip boat attacks (targetID === 0 means attacking sea/empty)
      if (!attack.targetID) {
        this.removeLabel(attack.id);
        continue;
      }

      const defender = this.game.playerBySmallID(attack.targetID);
      if (!defender || !defender.isPlayer()) {
        this.removeLabel(attack.id);
        continue;
      }

      const attackerTroops = attack.troops;
      const defenderTroops = defender.troops();

      let label = this.labels.get(attack.id);
      if (!label) {
        const element = this.createLabelElement(attackerTroops, defenderTroops);
        label = { attackID: attack.id, element, position: null };
        this.labels.set(attack.id, label);
      } else {
        this.updateLabelContent(label.element, attackerTroops, defenderTroops);
      }

      // Re-fetch position every tick so the label follows the moving front line
      const attackID = attack.id;
      if (this.inFlightPositionRequests.has(attackID)) continue;
      this.inFlightPositionRequests.add(attackID);

      void myPlayer
        .attackAveragePosition(attack.attackerID, attackID)
        .then((pos) => {
          const lbl = this.labels.get(attackID);
          if (!lbl) return;
          lbl.position = pos; // null hides stale label
        })
        .catch(() => {
          const lbl = this.labels.get(attackID);
          if (lbl) lbl.position = null;
        })
        .finally(() => {
          this.inFlightPositionRequests.delete(attackID);
        });
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
      if (!label.position) {
        label.element.style.display = "none";
        continue;
      }

      const isOnScreen = this.transformHandler.isOnScreen(label.position);
      if (!isOnScreen) {
        label.element.style.display = "none";
        continue;
      }

      label.element.style.display = "block";
      label.element.style.transform = `translate(${label.position.x}px, ${label.position.y}px) translate(-50%, -50%) scale(${1 / this.transformHandler.scale})`;
    }
  }

  private createLabelElement(
    attackerTroops: number,
    defenderTroops: number,
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
    this.updateLabelContent(el, attackerTroops, defenderTroops);
    this.container.appendChild(el);
    return el;
  }

  private updateLabelContent(
    el: HTMLDivElement,
    attackerTroops: number,
    defenderTroops: number,
  ) {
    const atkStr = renderTroops(attackerTroops);
    const defStr = renderTroops(defenderTroops);
    const advantage = attackerTroops > defenderTroops;

    const atk = document.createElement("span");
    atk.style.color = advantage ? "#66ff66" : "#ff6666";
    atk.textContent = `⚔ ${atkStr}`;

    const vs = document.createElement("span");
    vs.style.color = "#aaa";
    vs.textContent = " vs ";

    const def = document.createElement("span");
    def.style.color = "#ff9944";
    def.textContent = defStr;

    el.replaceChildren(atk, vs, def);
  }

  private removeLabel(attackID: string) {
    const label = this.labels.get(attackID);
    if (!label) return;
    label.element.remove();
    this.labels.delete(attackID);
    this.inFlightPositionRequests.delete(attackID);
  }

  private clearAllLabels() {
    for (const label of this.labels.values()) {
      label.element.remove();
    }
    this.labels.clear();
    this.inFlightPositionRequests.clear();
  }
}
