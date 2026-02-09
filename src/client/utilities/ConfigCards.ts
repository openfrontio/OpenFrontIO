import { TemplateResult, html, nothing } from "lit";
import { UnitType } from "../../core/game/Game";
import { translateText } from "../Utils";

// --- Shared button styling ---

export const PRIMARY_BUTTON =
  "w-full py-4 text-sm font-bold text-white uppercase tracking-widest bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5 active:translate-y-0 disabled:transform-none";

// --- Shared card styling ---

const BASE_CARD =
  "relative p-4 gap-3 min-h-[100px] overflow-hidden rounded-xl border transition-all duration-200 flex flex-col items-center w-full cursor-pointer active:scale-95";

export function cardStateClasses(
  selected: boolean,
  opts?: { disabled?: boolean; dimWhenOff?: boolean },
): string {
  if (opts?.disabled)
    return "opacity-30 grayscale cursor-not-allowed bg-white/5 border-white/5";
  if (selected)
    return "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]";
  return `bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20${opts?.dimWhenOff ? " opacity-80" : ""}`;
}

// --- Card image opacity ---

export function cardImageClasses(selected: boolean): string {
  return `w-full h-full object-cover ${selected ? "opacity-100" : "opacity-80"} group-hover:opacity-100 transition-opacity duration-200`;
}

// --- Category label ---

export function renderCategoryLabel(text: string): TemplateResult {
  return html`<h4
    class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
  >
    ${text}
  </h4>`;
}

// --- Card label ---

export function renderCardLabel(text: string, active: boolean): TemplateResult {
  return html`
    <div
      class="text-xs uppercase font-bold tracking-wider text-center w-full leading-tight break-words hyphens-auto ${active
        ? "text-white"
        : "text-white/60"}"
    >
      ${text}
    </div>
  `;
}

// --- Simple config card (button) ---

export function renderConfigCard(opts: {
  selected: boolean;
  disabled?: boolean;
  dimWhenOff?: boolean;
  onClick?: (e: Event) => void;
  label?: string;
  content?: TemplateResult;
}): TemplateResult {
  const active = !opts.disabled && opts.selected;
  return html`
    <button
      ?disabled=${opts.disabled}
      @click=${opts.onClick}
      class="${BASE_CARD} justify-center ${cardStateClasses(
        opts.selected,
        opts,
      )}"
    >
      ${opts.content ?? renderCardLabel(opts.label ?? "", active)}
    </button>
  `;
}

// --- Toggle card with checkbox + number input ---

export function renderCardInput(opts: {
  id?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  value?: number | string;
  ariaLabel?: string;
  placeholder?: string;
  onInput?: (e: Event) => void;
  onChange?: (e: Event) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}): TemplateResult {
  return html`
    <input
      type="number"
      id=${opts.id ?? nothing}
      min=${opts.min ?? nothing}
      max=${opts.max ?? nothing}
      step=${opts.step ?? nothing}
      .value=${String(opts.value ?? "")}
      class="w-full text-center rounded bg-black/60 text-white text-sm font-bold border border-white/20 focus:outline-none focus:border-blue-500 p-1 my-1"
      aria-label=${opts.ariaLabel ?? nothing}
      placeholder=${opts.placeholder ?? nothing}
      @click=${(e: Event) => e.stopPropagation()}
      @input=${opts.onInput}
      @change=${opts.onChange}
      @keydown=${opts.onKeyDown}
    />
  `;
}

export function renderToggleCard(opts: {
  labelKey: string;
  checked: boolean;
  onClick: (e: Event) => void;
  input?: TemplateResult;
}): TemplateResult {
  return html`
    <div
      role="button"
      tabindex="0"
      @click=${opts.onClick}
      @keydown=${(e: KeyboardEvent) => {
        if ((e.target as HTMLElement).tagName.toLowerCase() === "input") return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          opts.onClick(e);
        }
      }}
      class="${BASE_CARD} justify-between h-full ${cardStateClasses(
        opts.checked,
        {
          dimWhenOff: true,
        },
      )}"
    >
      <div class="flex items-center justify-center w-full mt-1">
        <div
          class="w-5 h-5 rounded border flex items-center justify-center transition-colors ${opts.checked
            ? "bg-blue-500 border-blue-500"
            : "border-white/20 bg-white/5"}"
        >
          ${opts.checked
            ? html`<svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-3 w-3 text-white"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clip-rule="evenodd"
                />
              </svg>`
            : ""}
        </div>
      </div>

      ${opts.checked
        ? (opts.input ?? html``)
        : html`<div class="h-[2px] w-4 bg-white/10 rounded my-3"></div>`}
      ${renderCardLabel(translateText(opts.labelKey), opts.checked)}
    </div>
  `;
}

// --- Unit type options grid ---

const UNIT_OPTIONS: { type: UnitType; translationKey: string }[] = [
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

export function renderUnitTypeOptions(
  disabledUnits: UnitType[],
  toggleUnit: (unit: UnitType, checked: boolean) => void,
): TemplateResult[] {
  return UNIT_OPTIONS.map(({ type, translationKey }) => {
    const isEnabled = !disabledUnits.includes(type);
    return renderConfigCard({
      selected: isEnabled,
      dimWhenOff: true,
      onClick: () => toggleUnit(type, isEnabled),
      label: translateText(translationKey),
    });
  });
}
