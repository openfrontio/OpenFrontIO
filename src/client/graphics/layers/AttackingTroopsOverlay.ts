import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { Cell } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent } from "../../InputHandler";
import { renderTroops } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
const soldierIcon = assetUrl("images/SoldierIcon.svg");

// Match AttacksDisplay: aquarius for outgoing, red-400 for incoming.
const OUTGOING_COLOR = "var(--color-aquarius)";
const INCOMING_COLOR = "var(--color-red-400)";

// At/above this zoom, the label stays at its full screen size. Below it the
// label shrinks linearly with zoom-out, floored so it never disappears.
const LABEL_FULL_SIZE_ZOOM = 1.5;
const LABEL_MIN_SCREEN_SCALE = 0.5;
const OUTGOING_ICON_FILTER =
  "brightness(0) saturate(100%) invert(62%) sepia(80%) saturate(500%) hue-rotate(175deg) brightness(100%)";
const INCOMING_ICON_FILTER =
  "brightness(0) saturate(100%) invert(27%) sepia(91%) saturate(4551%) hue-rotate(348deg) brightness(89%) contrast(97%)";

// Vertical strength bar to the left of the icon: grows in height as the
// attacker outnumbers the opposition. Maxes out at BAR_MAX_HEIGHT_PX when the
// attacker has BAR_FULL_HEIGHT_RATIO× the opposing troops.
const BAR_FULL_HEIGHT_RATIO = 2;
const BAR_MAX_HEIGHT_PX = 13;

// Element scale factor that, combined with the container's `scale(zoom)`,
// yields the desired on-screen label size: constant screen size when zoomed
// in past LABEL_FULL_SIZE_ZOOM, then shrinking linearly as zoom drops, with a
// floor at LABEL_MIN_SCREEN_SCALE so the label never disappears.
export function computeLabelScale(zoom: number): number {
  const netScale = Math.max(
    LABEL_MIN_SCREEN_SCALE,
    Math.min(1, zoom / LABEL_FULL_SIZE_ZOOM),
  );
  return netScale / zoom;
}

// Fraction (0–1) of BAR_MAX_HEIGHT_PX the strength bar should occupy. 0 means
// the attacker is harmless; 1 means they have BAR_FULL_HEIGHT_RATIO× or more
// of the opposing troops.
export function computeBarStrength(
  attackerTroops: number,
  opposingTroops: number,
): number {
  if (opposingTroops <= 0) return 1;
  return Math.min(1, attackerTroops / opposingTroops / BAR_FULL_HEIGHT_RATIO);
}

// Worker returns clusters sorted by size; two near-equal-size fronts can flip
// ordering tick-to-tick. If swapping brings each new position closer to where
// its label already is, swap `next` in place. (clusteredPositions caps at 2.)
export function alignClusterOrder(next: Cell[], prev: (Cell | null)[]): void {
  const [a, b] = prev;
  if (next.length !== 2 || !a || !b) return;
  const dist = (p: Cell, q: Cell) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
  const direct = dist(next[0], a) + dist(next[1], b);
  const swapped = dist(next[1], a) + dist(next[0], b);
  if (swapped < direct) [next[0], next[1]] = [next[1], next[0]];
}

// An attack can have multiple disconnected front-line segments, so elements
// and positions are parallel arrays with one entry per segment.
interface AttackLabel {
  elements: HTMLDivElement[];
  positions: (Cell | null)[];
  isIncoming: boolean;
  attackerTroops: number;
  barStrength: number;
}

export class AttackingTroopsOverlay implements Layer {
  private container: HTMLDivElement;
  private labelTemplate: HTMLDivElement;
  private labels = new Map<string, AttackLabel>();
  // Guard against queuing multiple worker requests in the same tick window.
  private inFlightRequest = false;
  private isVisible = true;
  private onAlternateView: (e: AlternateViewEvent) => void;
  // Last transform string written per element; lets renderLayer skip identical
  // re-assignments every frame (~60fps × N labels).
  private lastTransform = new WeakMap<HTMLDivElement, string>();

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

  private labelScale(): number {
    return computeLabelScale(this.transformHandler.scale);
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

    // Outgoing: cyan bar widens as our attack outnumbers the defender.
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
      const barStrength = computeBarStrength(attack.troops, defender.troops());
      this.ensureLabel(attack.id, attack.troops, false, barStrength);
    }

    // Incoming: red bar widens as the attacker outnumbers the player.
    for (const attack of myPlayer.incomingAttacks()) {
      activeIDs.add(attack.id);
      const attacker = this.game.playerBySmallID(attack.attackerID);
      if (!attacker || !attacker.isPlayer()) {
        this.removeLabel(attack.id);
        continue;
      }
      const barStrength = computeBarStrength(attack.troops, myPlayer.troops());
      this.ensureLabel(attack.id, attack.troops, true, barStrength);
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
    isIncoming: boolean,
    barStrength: number,
  ) {
    let label = this.labels.get(attackID);
    if (!label) {
      label = {
        elements: [],
        positions: [],
        isIncoming,
        attackerTroops,
        barStrength,
      };
      this.labels.set(attackID, label);
    } else {
      label.attackerTroops = attackerTroops;
      label.barStrength = barStrength;
    }
    for (const el of label.elements) {
      this.updateLabelContent(el, attackerTroops, barStrength);
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

    // Hoist the per-frame label scale once; zoom is constant within a frame.
    const scale = this.labelScale();
    for (const label of this.labels.values()) {
      for (let i = 0; i < label.elements.length; i++) {
        const el = label.elements[i];
        const pos = label.positions[i];

        if (!pos || !this.transformHandler.isOnScreen(pos)) {
          el.style.display = "none";
          continue;
        }

        el.style.display = "inline-flex";
        // Centre the label on its world position; counter-scale keeps the
        // label at constant screen size while zoomed in, then it shrinks
        // (floored) as zoom drops below LABEL_FULL_SIZE_ZOOM.
        const transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) scale(${scale})`;
        if (this.lastTransform.get(el) !== transform) {
          el.style.transform = transform;
          this.lastTransform.set(el, transform);
        }
      }
    }
  }

  private reconcileLabelPositions(lbl: AttackLabel, positions: Cell[]) {
    // Add elements for new clusters.
    while (lbl.elements.length < positions.length) {
      lbl.elements.push(
        this.createLabelElement(
          lbl.attackerTroops,
          lbl.isIncoming,
          lbl.barStrength,
        ),
      );
      lbl.positions.push(null);
    }

    // Remove elements for clusters that no longer exist.
    while (lbl.elements.length > positions.length) {
      lbl.elements.pop()!.remove();
      lbl.positions.pop();
    }

    alignClusterOrder(positions, lbl.positions);

    // Snap teleport-sized jumps instantly; let the CSS transition handle the rest.
    for (let i = 0; i < positions.length; i++) {
      const old = lbl.positions[i];
      const next = positions[i];
      if (old && Math.hypot(next.x - old.x, next.y - old.y) > 200) {
        const el = lbl.elements[i];
        el.style.transition = "none";
        const transform = `translate(${next.x}px, ${next.y}px) translate(-50%, -50%) scale(${this.labelScale()})`;
        el.style.transform = transform;
        this.lastTransform.set(el, transform);
        requestAnimationFrame(() => {
          el.style.transition = "transform 0.25s linear";
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
    el.style.fontSize = "14px";
    el.style.fontWeight = "bold";
    el.style.padding = "2px 5px";
    el.style.borderRadius = "3px";
    el.style.backgroundColor = "rgba(0,0,0,0.85)";
    el.style.pointerEvents = "none";
    el.style.lineHeight = "1.3";
    el.style.transition = "transform 0.25s linear";
    el.style.width = "max-content";

    const bar = document.createElement("div");
    bar.style.width = "2px";
    bar.style.borderRadius = "1px";
    bar.style.alignSelf = "flex-end";
    bar.style.transition = "height 0.25s linear";
    el.appendChild(bar);

    const icon = document.createElement("img");
    icon.style.width = "13px";
    icon.style.height = "13px";
    el.appendChild(icon);

    const span = document.createElement("span");
    span.style.minWidth = "25px";
    el.appendChild(span);

    return el;
  }

  private createLabelElement(
    attackerTroops: number,
    isIncoming: boolean,
    barStrength: number,
  ): HTMLDivElement {
    const el = this.labelTemplate.cloneNode(true) as HTMLDivElement;
    el.style.fontFamily = this.game.config().theme().font();
    const bar = el.children[0] as HTMLDivElement;
    const icon = el.children[1] as HTMLImageElement;
    const span = el.children[2] as HTMLSpanElement;
    icon.src = soldierIcon;
    icon.style.filter = isIncoming
      ? INCOMING_ICON_FILTER
      : OUTGOING_ICON_FILTER;
    span.style.color = isIncoming ? INCOMING_COLOR : OUTGOING_COLOR;
    span.textContent = renderTroops(attackerTroops);
    bar.style.backgroundColor = isIncoming ? INCOMING_COLOR : OUTGOING_COLOR;
    bar.style.height = `${barStrength * BAR_MAX_HEIGHT_PX}px`;
    this.container.appendChild(el);
    return el;
  }

  private updateLabelContent(
    el: HTMLDivElement,
    attackerTroops: number,
    barStrength: number,
  ) {
    const bar = el.children[0] as HTMLDivElement;
    const span = el.children[2] as HTMLSpanElement;
    span.textContent = renderTroops(attackerTroops);
    bar.style.height = `${barStrength * BAR_MAX_HEIGHT_PX}px`;
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
