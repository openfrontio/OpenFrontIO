// renderUnitTypeOptions.ts
import { html, TemplateResult } from "lit";
import { UnitType } from "../../core/game/Game";
import { translateText } from "../Utils";

export type UnitTypeRenderContext = {
  disabledUnits: UnitType[];
  toggleUnit: (unit: UnitType, checked: boolean) => void;
};

const unitOptions: { type: UnitType; translationKey: string }[] = [
  { translationKey: "unit_type.city", type: UnitType.City },
  { translationKey: "unit_type.defense_post", type: UnitType.DefensePost },
  { translationKey: "unit_type.port", type: UnitType.Port },
  { translationKey: "unit_type.warship", type: UnitType.Warship },
  { translationKey: "unit_type.missile_silo", type: UnitType.MissileSilo },
  { translationKey: "unit_type.sam_launcher", type: UnitType.SAMLauncher },
  { translationKey: "unit_type.atom_bomb", type: UnitType.AtomBomb },
  { translationKey: "unit_type.hydrogen_bomb", type: UnitType.HydrogenBomb },
  { translationKey: "unit_type.mirv", type: UnitType.MIRV },
  { translationKey: "unit_type.factory", type: UnitType.Factory },
];

export function renderUnitTypeOptions({
  disabledUnits,
  toggleUnit,
}: UnitTypeRenderContext): TemplateResult[] {
  return unitOptions.map(
    ({ type, translationKey }) => html`
      <label
        class="option-card ${disabledUnits.includes(type) ? "" : "selected"}"
        style="width: 140px;"
      >
        <div class="checkbox-icon"></div>
        <input
          type="checkbox"
          .checked=${disabledUnits.includes(type)}
          @change=${(e: Event) => {
            const { checked } = e.target as HTMLInputElement;
            toggleUnit(type, checked);
          }}
        />
        <div class="option-card-title" style="text-align: center;">
          ${translateText(translationKey)}
        </div>
      </label>
    `,
  );
}
