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
    const isOn = !disabledUnits.includes(type);

    const cardClasses = [
      "group",
      "w-full",
      "cursor-pointer",
      "select-none",
      "rounded-xl",
      "border",
      "p-2",
      "flex",
      "items-center",
      "justify-between",
      "gap-3",
      "transition-colors",
      isOn
        ? "border-emerald-400/40 bg-transparent text-zinc-100"
        : "border-white/15 bg-transparent text-zinc-200 hover:border-white/25 hover:bg-white/5",
    ].join(" ");

    const chipClasses = [
      "inline-flex",
      "items-center",
      "rounded-full",
      "border",
      "px-2",
      "py-0.5",
      "text-sm",
      "font-semibold",
      isOn
        ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-100"
        : "border-rose-400/30 bg-rose-400/20 text-rose-100",
    ].join(" ");

    const label = translateText(translationKey);
    return html`
      <label class="${cardClasses}" title="${label}">
        <div class="flex items-center gap-3">
          <input
            type="checkbox"
            class="h-4 w-4 accent-blue-400 focus-visible:outline-none"
            .checked=${isOn}
            @change=${(e: Event) => {
              const checked = (e.target as HTMLInputElement).checked;
              toggleUnit(type, !checked);
            }}
            aria-label=${label}
          />
          <span class="font-medium leading-6"> ${label} </span>
        </div>

        <span class="${chipClasses}" aria-hidden="true">
          ${isOn
            ? translateText("user_setting.on")
            : translateText("user_setting.off")}
        </span>
      </label>
    `;
  });
}
