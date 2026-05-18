import { EventBus } from "../../../core/EventBus";
import { Cell, PlayerType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent } from "../../InputHandler";
import { renderTroops } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

// Match AttacksDisplay: aquarius for outgoing, red-400 for incoming.
const OUTGOING_COLOR = "var(--color-aquarius)";
const INCOMING_COLOR = "var(--color-red-400)";

// At/above this zoom the label is rendered at full size; below it shrinks
// linearly toward LABEL_MIN_RENDERED_SIZE as zoom→0.
const LABEL_FULL_SIZE_ZOOM = 4.0;
const LABEL_MIN_RENDERED_SIZE = 0.63;
// Overall size multiplier applied to the rendered label.
const LABEL_SIZE_MULTIPLIER = 1.0;

// Counter-scale against the container's `scale(zoom)`. At/above
// LABEL_FULL_SIZE_ZOOM the rendered size is capped at LABEL_SIZE_MULTIPLIER;
// below it the rendered size shrinks linearly toward
// LABEL_SIZE_MULTIPLIER * LABEL_MIN_RENDERED_SIZE as zoom→0.
export function computeLabelScale(zoom: number): number {
  const t = Math.min(1, zoom / LABEL_FULL_SIZE_ZOOM);
  const renderedSize =
    LABEL_SIZE_MULTIPLIER *
    (LABEL_MIN_RENDERED_SIZE + (1 - LABEL_MIN_RENDERED_SIZE) * t);
  return renderedSize / zoom;
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

    // Outgoing: only label attacks targeting another player.
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
      this.ensureLabel(attack.id, attack.troops, false);
    }

    // Incoming: only label attacks coming from another player; skip tribes.
    for (const attack of myPlayer.incomingAttacks()) {
      activeIDs.add(attack.id);
      const attacker = this.game.playerBySmallID(attack.attackerID);
      if (
        !attacker ||
        !attacker.isPlayer() ||
        attacker.type() === PlayerType.Bot
      ) {
        this.removeLabel(attack.id);
        continue;
      }
      this.ensureLabel(attack.id, attack.troops, true);
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
  ) {
    let label = this.labels.get(attackID);
    if (!label) {
      label = {
        elements: [],
        positions: [],
        isIncoming,
        attackerTroops,
      };
      this.labels.set(attackID, label);
    } else {
      label.attackerTroops = attackerTroops;
    }
    for (const el of label.elements) {
      this.updateLabelContent(el, attackerTroops);
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
    const innerTransform = `scale(${scale})`;
    for (const label of this.labels.values()) {
      for (let i = 0; i < label.elements.length; i++) {
        const el = label.elements[i];
        const pos = label.positions[i];

        if (!pos || !this.transformHandler.isOnScreen(pos)) {
          el.style.display = "none";
          continue;
        }

        el.style.display = "";
        const inner = el.children[0] as HTMLDivElement;
        // Outer: world position only — the 0.25s transition smooths cluster
        // shifts. Inner: scale only — applied without transition so zoom is
        // instant.
        const outerTransform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
        if (this.lastTransform.get(el) !== outerTransform) {
          el.style.transform = outerTransform;
          this.lastTransform.set(el, outerTransform);
        }
        inner.style.transform = innerTransform;
      }
    }
  }

  private reconcileLabelPositions(lbl: AttackLabel, positions: Cell[]) {
    // Add elements for new clusters.
    while (lbl.elements.length < positions.length) {
      lbl.elements.push(
        this.createLabelElement(lbl.attackerTroops, lbl.isIncoming),
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
        const outerTransform = `translate(${next.x}px, ${next.y}px) translate(-50%, -50%)`;
        el.style.transform = outerTransform;
        this.lastTransform.set(el, outerTransform);
        requestAnimationFrame(() => {
          el.style.transition = "transform 0.25s linear";
        });
      }
      lbl.positions[i] = next;
    }
  }

  // Outer wraps position+transition (animates cluster moves). Inner holds the
  // scale (instant on zoom) plus all visual chrome. Splitting them keeps the
  // 0.25s transition off zoom changes.
  private createLabelTemplate(): HTMLDivElement {
    const outer = document.createElement("div");
    outer.style.position = "absolute";
    outer.style.display = "none";
    outer.style.pointerEvents = "none";
    outer.style.transition = "transform 0.25s linear";

    const inner = document.createElement("div");
    inner.style.whiteSpace = "nowrap";
    inner.style.fontSize = "17px";
    inner.style.fontWeight = "bold";
    inner.style.lineHeight = "1.3";
    inner.style.width = "max-content";
    // No background — let the territory border show through. Stacked black
    // text-shadows form a soft dark glow so the number stays readable over
    // any terrain.
    inner.style.textShadow =
      "0 0 2px rgba(0,0,0,1), 0 0 3px rgba(0,0,0,0.85), 0 0 5px rgba(0,0,0,0.5)";
    outer.appendChild(inner);

    return outer;
  }

  private createLabelElement(
    attackerTroops: number,
    isIncoming: boolean,
  ): HTMLDivElement {
    const el = this.labelTemplate.cloneNode(true) as HTMLDivElement;
    const inner = el.children[0] as HTMLDivElement;
    inner.style.fontFamily = this.game.config().theme().font();
    inner.style.color = isIncoming ? INCOMING_COLOR : OUTGOING_COLOR;
    inner.textContent = renderTroops(attackerTroops);
    this.container.appendChild(el);
    return el;
  }

  private updateLabelContent(el: HTMLDivElement, attackerTroops: number) {
    const inner = el.children[0] as HTMLDivElement;
    inner.textContent = renderTroops(attackerTroops);
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
