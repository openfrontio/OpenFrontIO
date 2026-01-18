import { TemplateResult, html, nothing } from "lit";
import { translateText } from "../Utils";

export const TOGGLE_INPUT_CARD_CLASSES = {
  containerActive:
    "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]",
  containerInactive:
    "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80",
  labelBase:
    "text-[10px] uppercase font-bold tracking-wider text-center w-full leading-tight break-words hyphens-auto",
  labelActive: "text-white",
  labelInactive: "text-white/60",
  input:
    "w-full text-center rounded bg-black/60 text-white text-sm font-bold border border-white/20 focus:outline-none focus:border-blue-500 p-1 my-1",
};

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
  className?: string;
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
  className = TOGGLE_INPUT_CARD_CLASSES.input,
}: ToggleInputCardInputOptions): TemplateResult {
  const resolvedValue = value ?? "";
  const handleClick = onClick ?? ((e: Event) => e.stopPropagation());

  return html`
    <input
      type=${type}
      id=${id ?? nothing}
      min=${min ?? nothing}
      max=${max ?? nothing}
      step=${step ?? nothing}
      .value=${String(resolvedValue)}
      class=${className}
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
  activeClassName?: string;
  inactiveClassName?: string;
  labelBaseClassName?: string;
  labelActiveClassName?: string;
  labelInactiveClassName?: string;
  role?: string;
  tabIndex?: number;
}

export function renderToggleInputCard({
  labelKey,
  checked,
  input,
  onClick,
  onKeyDown,
  activeClassName = TOGGLE_INPUT_CARD_CLASSES.containerActive,
  inactiveClassName = TOGGLE_INPUT_CARD_CLASSES.containerInactive,
  labelBaseClassName = TOGGLE_INPUT_CARD_CLASSES.labelBase,
  labelActiveClassName = TOGGLE_INPUT_CARD_CLASSES.labelActive,
  labelInactiveClassName = TOGGLE_INPUT_CARD_CLASSES.labelInactive,
  role,
  tabIndex,
}: ToggleInputCardRenderContext): TemplateResult {
  const shouldBehaveLikeButton = Boolean(onClick ?? onKeyDown);
  const resolvedRole = role ?? (shouldBehaveLikeButton ? "button" : undefined);
  const resolvedTabIndex = tabIndex ?? (shouldBehaveLikeButton ? 0 : undefined);
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
      class="relative p-3 rounded-xl border transition-all duration-200 flex flex-col items-center justify-between gap-2 h-full cursor-pointer min-h-[100px] ${checked
        ? activeClassName
        : inactiveClassName}"
    >
      <div class="flex items-center justify-center w-full mt-1">
        <div
          class="w-5 h-5 rounded border flex items-center justify-center transition-colors ${checked
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
      </div>

      ${checked
        ? (input ?? html``)
        : html`<div class="h-[2px] w-4 bg-white/10 rounded my-3"></div>`}

      <div
        class="${labelBaseClassName} ${checked
          ? labelActiveClassName
          : labelInactiveClassName}"
      >
        ${translateText(labelKey)}
      </div>
    </div>
  `;
}
