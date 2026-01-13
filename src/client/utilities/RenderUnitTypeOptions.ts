import { html, TemplateResult } from "lit";
import { UnitType } from "../../core/game/Game";
import { renderSectionHeader } from "../components/ui/LobbyModalShell";
import { renderOptionToggle } from "../components/ui/OptionToggle";

export interface UnitTypeRenderContext {
  disabledUnits: UnitType[];
  toggleUnit: (unit: UnitType, enabled: boolean) => void;
}

export interface UnitTypeSectionProps extends UnitTypeRenderContext {
  titleKey: string;
}

const unitOptions: { type: UnitType; translationKey: string }[] = [
  { type: UnitType.City, translationKey: "unit_type.city" },
  { type: UnitType.DefensePost, translationKey: "unit_type.defense_post" },
  { type: UnitType.Port, translationKey: "unit_type.port" },
  { type: UnitType.Warship, translationKey: "unit_type.warship" },
  { type: UnitType.MissileSilo, translationKey: "unit_type.missile_silo" },
  { type: UnitType.SAMLauncher, translationKey: "unit_type.sam_launcher" },
  { type: UnitType.AtomBomb, translationKey: "unit_type.atom_bomb" },
  { type: UnitType.HydrogenBomb, translationKey: "unit_type.hydrogen_bomb" },
  { type: UnitType.MIRV, translationKey: "unit_type.mirv" },
  { type: UnitType.Factory, translationKey: "unit_type.factory" },
];

export function renderUnitTypeOptions({
  disabledUnits,
  toggleUnit,
}: UnitTypeRenderContext): TemplateResult[] {
  const disabledSet = new Set(disabledUnits);
  return unitOptions.map(({ type, translationKey }) => {
    const isEnabled = !disabledSet.has(type);
    return renderOptionToggle({
      labelKey: translationKey,
      checked: isEnabled,
      onToggle: (nextEnabled) => toggleUnit(type, nextEnabled),
    });
  });
}

export function renderUnitTypeSection({
  titleKey,
  disabledUnits,
  toggleUnit,
}: UnitTypeSectionProps): TemplateResult {
  return html`
    <div class="space-y-6">
      ${renderSectionHeader({
        titleKey,
        iconClassName: "bg-teal-500/20 text-teal-400",
        icon: html`
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            class="w-5 h-5"
          >
            <path
              fill-rule="evenodd"
              d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm0 8.625a1.125 1.125 0 100 2.25 1.125 1.125 0 000-2.25zM15.375 12a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0zM7.5 10.875a1.125 1.125 0 100 2.25 1.125 1.125 0 000-2.25z"
              clip-rule="evenodd"
            />
          </svg>
        `,
      })}
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        ${renderUnitTypeOptions({ disabledUnits, toggleUnit })}
      </div>
    </div>
  `;
}
