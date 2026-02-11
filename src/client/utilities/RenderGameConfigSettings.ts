import { SVGTemplateResult, TemplateResult, html, nothing, svg } from "lit";
import {
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
  UnitType,
} from "../../core/game/Game";
import { TeamCountConfig } from "../../core/Schemas";
import "../components/Difficulties";
import "../components/FluentSlider";
import "../components/map/MapPicker";
import { translateText } from "../Utils";

// --- Shared card styles ---

export const ACTIVE_CARD =
  "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]";
export const INACTIVE_CARD =
  "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20";

const DISABLED_CARD =
  "w-full rounded-xl border transition-all duration-200 opacity-30 grayscale cursor-not-allowed bg-white/5 border-white/5";

export function cardClass(active: boolean, extra = ""): string {
  return `w-full rounded-xl border cursor-pointer transition-all duration-200 active:scale-95 ${extra} ${active ? ACTIVE_CARD : INACTIVE_CARD}`;
}

// --- Toggle input card ---

export interface ToggleInputCardInputOptions {
  id?: string;
  type?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  value?: number | string;
  ariaLabel?: string;
  placeholder?: string;
  onInput?: (e: Event) => void;
  onChange?: (e: Event) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  onClick?: (e: Event) => void;
}

const INPUT_CLASS =
  "w-full text-center rounded bg-black/60 text-white text-sm font-bold border border-white/20 focus:outline-none focus:border-blue-500 p-1 my-1";
const CARD_LABEL_CLASS =
  "text-xs uppercase font-bold tracking-wider leading-tight break-words hyphens-auto";

const DIFFICULTY_OPTIONS = Object.entries(Difficulty).filter(([key]) =>
  isNaN(Number(key)),
) as Array<[string, Difficulty]>;
const TEAM_COUNT_OPTIONS: TeamCountConfig[] = [
  2,
  3,
  4,
  5,
  6,
  7,
  Quads,
  Trios,
  Duos,
  HumansVsNations,
];

function stateTextClass(active: boolean): string {
  return active ? "text-white" : "text-white/60";
}

export function renderToggleInputCardInput({
  id,
  type = "number",
  min,
  max,
  step,
  value,
  ariaLabel,
  placeholder,
  onInput,
  onChange,
  onKeyDown,
  onClick,
}: ToggleInputCardInputOptions): TemplateResult {
  const handleClick = onClick ?? ((e: Event) => e.stopPropagation());

  return html`
    <input
      type=${type}
      id=${id ?? nothing}
      min=${min ?? nothing}
      max=${max ?? nothing}
      step=${step ?? nothing}
      .value=${String(value ?? "")}
      class=${INPUT_CLASS}
      aria-label=${ariaLabel ?? nothing}
      placeholder=${placeholder ?? nothing}
      @click=${handleClick}
      @input=${onInput}
      @change=${onChange}
      @keydown=${onKeyDown}
    />
  `;
}

export interface ToggleInputCardRenderContext {
  labelKey: string;
  checked: boolean;
  input?: TemplateResult;
  onClick?: (e: Event) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}

export function renderToggleInputCard({
  labelKey,
  checked,
  input,
  onClick,
  onKeyDown,
}: ToggleInputCardRenderContext): TemplateResult {
  const shouldBehaveLikeButton = Boolean(onClick ?? onKeyDown);
  const resolvedRole = shouldBehaveLikeButton ? "button" : undefined;
  const resolvedTabIndex = shouldBehaveLikeButton ? 0 : undefined;
  const resolvedOnKeyDown =
    onKeyDown ??
    (onClick
      ? (e: KeyboardEvent) => {
          if ((e.target as HTMLElement).tagName.toLowerCase() === "input") {
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(e);
          }
        }
      : undefined);

  return html`
    <div
      role=${resolvedRole ?? nothing}
      tabindex=${resolvedTabIndex ?? nothing}
      @click=${onClick}
      @keydown=${resolvedOnKeyDown}
      class="${cardClass(
        checked,
        "p-3 flex flex-col items-center justify-between gap-2 h-full",
      )}"
    >
      <div
        class="w-5 h-5 rounded border flex items-center justify-center transition-colors mt-1 ${checked
          ? "bg-blue-500 border-blue-500"
          : "border-white/20 bg-white/5"}"
      >
        ${checked
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

      ${checked
        ? (input ?? html``)
        : html`<div class="h-[2px] w-4 rounded my-3 bg-white/10"></div>`}

      <span class="${CARD_LABEL_CLASS} text-center ${stateTextClass(checked)}">
        ${translateText(labelKey)}
      </span>
    </div>
  `;
}

function renderTextCardButton(
  label: string,
  active: boolean,
  onClick: () => void,
  cardExtraClass: string,
): TemplateResult {
  return html`
    <button class="${cardClass(active, cardExtraClass)}" @click=${onClick}>
      <span class="${CARD_LABEL_CLASS} ${stateTextClass(active)}">
        ${label}
      </span>
    </button>
  `;
}

function renderSection(
  iconSvg: SVGTemplateResult,
  colorClass: string,
  bgClass: string,
  titleKey: string,
  content: TemplateResult | TemplateResult[],
): TemplateResult {
  return html`
    <section class="space-y-6">
      ${renderSectionHeader(iconSvg, colorClass, bgClass, titleKey)} ${content}
    </section>
  `;
}

// --- Unit type options ---

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

function renderUnitTypeOptions(
  disabledUnits: UnitType[],
  toggleUnit: (unit: UnitType, checked: boolean) => void,
): TemplateResult[] {
  return unitOptions.map(({ type, translationKey }) => {
    const isEnabled = !disabledUnits.includes(type);
    return html`
      <button
        class="${cardClass(isEnabled, "p-4 text-center")}"
        aria-pressed=${isEnabled}
        @click=${() => toggleUnit(type, isEnabled)}
      >
        <span class="${CARD_LABEL_CLASS} ${stateTextClass(isEnabled)}">
          ${translateText(translationKey)}
        </span>
      </button>
    `;
  });
}

// --- Section headers ---

const MAP_ICON = svg`<path
  d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32L19.513 8.2z"
/>`;

const DIFFICULTY_ICON = svg`<path
  fill-rule="evenodd"
  d="M12.97 3.97a.75.75 0 011.06 0l7.5 7.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 11-1.06-1.06l6.22-6.22H3a.75.75 0 010-1.5h16.19l-6.22-6.22a.75.75 0 010-1.06z"
  clip-rule="evenodd"
/>`;

const MODE_ICON = svg`<path
  d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 18.75c1.995 0 3.823.707 5.25 1.886V4.533zM12.75 20.636A8.214 8.214 0 0118 18.75c.966 0 1.89.166 2.75.47a.75.75 0 001-.708V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533v16.103z"
/>`;

const OPTIONS_ICON = svg`<path
  fill-rule="evenodd"
  d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 00-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 00-2.282.819l-.922 1.597a1.875 1.875 0 00.432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 000 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 00-.432 2.385l.922 1.597a1.875 1.875 0 002.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 002.28-.819l.922-1.597a1.875 1.875 0 00-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 000-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 00-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 00-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 00-1.85-1.567h-1.843zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
  clip-rule="evenodd"
/>`;

const ENABLES_ICON = svg`<path
  fill-rule="evenodd"
  d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zm0 8.625a1.125 1.125 0 100 2.25 1.125 1.125 0 000-2.25zM15.375 12a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0zM7.5 10.875a1.125 1.125 0 100 2.25 1.125 1.125 0 000-2.25z"
  clip-rule="evenodd"
/>`;

function renderSectionHeader(
  iconSvg: SVGTemplateResult,
  colorClass: string,
  bgClass: string,
  titleKey: string,
): TemplateResult {
  return html`
    <div class="flex items-center gap-4 pb-2 border-b border-white/10">
      <div
        class="w-8 h-8 rounded-lg flex items-center justify-center ${bgClass} ${colorClass}"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="w-5 h-5"
        >
          ${iconSvg}
        </svg>
      </div>
      <h3 class="text-lg font-bold text-white uppercase tracking-wider">
        ${translateText(titleKey)}
      </h3>
    </div>
  `;
}

// --- Main game config ---

export interface ToggleOption {
  labelKey: string;
  checked: boolean;
  onChange: (val: boolean) => void;
  hidden?: boolean;
}

export interface GameConfigSettings {
  map: {
    selected: GameMapType;
    useRandom: boolean;
    randomMapDivider?: boolean;
    showMedals?: boolean;
    mapWins?: Map<GameMapType, Set<Difficulty>>;
    onSelectMap: (map: GameMapType) => void;
    onSelectRandom: () => void;
  };
  difficulty: {
    selected: Difficulty;
    disabled: boolean;
    onSelect: (d: Difficulty) => void;
  };
  gameMode: {
    selected: GameMode;
    onSelect: (mode: GameMode) => void;
  };
  teamCount: {
    selected: TeamCountConfig;
    onSelect: (count: TeamCountConfig) => void;
  };
  options: {
    titleKey: string;
    bots: {
      value: number;
      labelKey: string;
      disabledKey: string;
      onChange: (e: Event) => void;
    };
    toggles: ToggleOption[];
    inputCards: TemplateResult[];
  };
  unitTypes: {
    titleKey: string;
    disabledUnits: UnitType[];
    toggleUnit: (unit: UnitType, checked: boolean) => void;
  };
}

function renderOptionToggle(toggle: ToggleOption): TemplateResult {
  if (toggle.hidden) return html``;

  return renderTextCardButton(
    translateText(toggle.labelKey),
    toggle.checked,
    () => toggle.onChange(!toggle.checked),
    "p-4 text-center",
  );
}

export function renderGameConfigSettings(
  settings: GameConfigSettings,
): TemplateResult {
  return html`
    ${renderSection(
      MAP_ICON,
      "text-blue-400",
      "bg-blue-500/20",
      "map.map",
      html`<map-picker
        .selectedMap=${settings.map.selected}
        .useRandomMap=${settings.map.useRandom}
        .randomMapDivider=${settings.map.randomMapDivider ?? false}
        .showMedals=${settings.map.showMedals ?? false}
        .mapWins=${settings.map.mapWins ?? new Map()}
        .onSelectMap=${settings.map.onSelectMap}
        .onSelectRandom=${settings.map.onSelectRandom}
      ></map-picker>`,
    )}
    ${renderSection(
      DIFFICULTY_ICON,
      "text-green-400",
      "bg-green-500/20",
      "difficulty.difficulty",
      html`
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          ${DIFFICULTY_OPTIONS.map(([key, value]) => {
            const isSelected = settings.difficulty.selected === value;
            const isDisabled = settings.difficulty.disabled;
            return html`
              <button
                ?disabled=${isDisabled}
                @click=${() =>
                  !isDisabled &&
                  settings.difficulty.onSelect(value as Difficulty)}
                class="${isDisabled
                  ? `${DISABLED_CARD} flex flex-col items-center p-4 gap-3`
                  : cardClass(
                      isSelected,
                      "flex flex-col items-center p-4 gap-3",
                    )}"
              >
                <difficulty-display
                  .difficultyKey=${key}
                  class="transform scale-125 origin-center ${isDisabled
                    ? "pointer-events-none"
                    : ""}"
                ></difficulty-display>
                <span class="${CARD_LABEL_CLASS} text-center mt-1 text-white">
                  ${translateText(`difficulty.${key.toLowerCase()}`)}
                </span>
              </button>
            `;
          })}
        </div>
      `,
    )}
    ${renderSection(
      MODE_ICON,
      "text-purple-400",
      "bg-purple-500/20",
      "host_modal.mode",
      html`
        <div class="grid grid-cols-2 gap-4">
          ${[GameMode.FFA, GameMode.Team].map((mode) => {
            const isSelected = settings.gameMode.selected === mode;
            return html`
              <button
                class="${cardClass(isSelected, "py-6 text-center")}"
                @click=${() => settings.gameMode.onSelect(mode)}
              >
                <span
                  class="text-sm font-bold text-white uppercase tracking-widest"
                >
                  ${mode === GameMode.FFA
                    ? translateText("game_mode.ffa")
                    : translateText("game_mode.teams")}
                </span>
              </button>
            `;
          })}
        </div>
      `,
    )}
    ${settings.gameMode.selected === GameMode.FFA
      ? ""
      : html`
          <section class="space-y-6">
            <div
              class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
            >
              ${translateText("host_modal.team_count")}
            </div>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
              ${TEAM_COUNT_OPTIONS.map((o) => {
                const isSelected = settings.teamCount.selected === o;
                return html`
                  <button
                    class="${cardClass(isSelected, "px-4 py-3 text-center")}"
                    @click=${() => settings.teamCount.onSelect(o)}
                  >
                    <span class="${CARD_LABEL_CLASS} text-white">
                      ${typeof o === "string"
                        ? o === HumansVsNations
                          ? translateText("public_lobby.teams_hvn")
                          : translateText(`host_modal.teams_${o}`)
                        : translateText("public_lobby.teams", { num: o })}
                    </span>
                  </button>
                `;
              })}
            </div>
          </section>
        `}
    ${renderSection(
      OPTIONS_ICON,
      "text-orange-400",
      "bg-orange-500/20",
      settings.options.titleKey,
      html`
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div
            class="col-span-2 rounded-xl p-4 flex flex-col justify-center border transition-all duration-200 ${settings
              .options.bots.value > 0
              ? ACTIVE_CARD
              : INACTIVE_CARD}"
          >
            <fluent-slider
              min="0"
              max="400"
              step="1"
              .value=${settings.options.bots.value}
              labelKey=${settings.options.bots.labelKey}
              disabledKey=${settings.options.bots.disabledKey}
              @value-changed=${settings.options.bots.onChange}
            ></fluent-slider>
          </div>

          ${settings.options.toggles.map((toggle) =>
            renderOptionToggle(toggle),
          )}
          ${settings.options.inputCards}
        </div>
      `,
    )}
    ${renderSection(
      ENABLES_ICON,
      "text-teal-400",
      "bg-teal-500/20",
      settings.unitTypes.titleKey,
      html`
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          ${renderUnitTypeOptions(
            settings.unitTypes.disabledUnits,
            settings.unitTypes.toggleUnit,
          )}
        </div>
      `,
    )}
  `;
}
