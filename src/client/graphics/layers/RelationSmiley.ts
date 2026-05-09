import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Relation } from "../../../core/game/Game";

type FaceData = {
  color: string;
  eyeCy: number;
  mouth: string;
  brows?: string[];
};
const RELATION_FACES: Partial<Record<Relation, FaceData>> = {
  [Relation.Hostile]: {
    color: "#ef4444",
    eyeCy: 7.5,
    mouth: "M5 12 Q8 9 11 12",
    brows: ["M4 5.5 L6.5 7", "M12 5.5 L9.5 7"],
  },
  [Relation.Distrustful]: {
    color: "#f97316",
    eyeCy: 6.8,
    mouth: "M5.5 11 Q8 9.2 10.5 11",
  },
  [Relation.Friendly]: {
    color: "#22c55e",
    eyeCy: 6.5,
    mouth: "M5 10 Q8 13 11 10",
  },
};

@customElement("relation-smiley")
export class RelationSmiley extends LitElement {
  @property({ type: Number })
  relation: Relation = Relation.Neutral;

  createRenderRoot() {
    return this;
  }

  render() {
    const face = RELATION_FACES[this.relation];
    if (!face) return html``;
    const { color, eyeCy, mouth, brows } = face;
    return html`<svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      style="flex-shrink:0"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="${color}"
        stroke-width="1.4"
        fill="none"
      />
      ${brows?.map(
        (d) =>
          html`<path
            d="${d}"
            stroke="${color}"
            stroke-width="1.4"
            stroke-linecap="round"
          />`,
      )}
      <circle cx="5.8" cy="${eyeCy}" r="0.9" fill="${color}" />
      <circle cx="10.2" cy="${eyeCy}" r="0.9" fill="${color}" />
      <path
        d="${mouth}"
        stroke="${color}"
        stroke-width="1.4"
        fill="none"
        stroke-linecap="round"
      />
    </svg>`;
  }
}
