import { html, TemplateResult } from "lit";
import { UnitType } from "../../core/game/Game";
import { translateText } from "../Utils";

export interface UnitTypeRenderContext {
  disabledUnits: UnitType[];
  toggleUnit: (unit: UnitType, checked: boolean) => void;
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
  return unitOptions.map(({ type, translationKey }) => {
    const isEnabled = !disabledUnits.includes(type);
    return html`
      <button
        class="relative p-4 rounded-xl border transition-all duration-200 flex flex-col items-center justify-center gap-2 min-h-[100px] w-full cursor-pointer ${isEnabled
          ? "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
          : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80"}"
        @click=${() => toggleUnit(type, isEnabled)}
      >
        <div
          class="text-xs uppercase font-bold tracking-wider text-center w-full leading-tight break-words hyphens-auto ${isEnabled
            ? "text-white"
            : "text-white/60"}"
        >
          ${translateText(translationKey)}
        </div>
      </button>
    `;
  });
}
