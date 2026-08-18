import { html, TemplateResult } from "lit";

export interface StyledSelectOption {
  value: string;
  label: string;
}

export interface StyledSelectProps {
  options: StyledSelectOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  /** Extra classes for the wrapper, e.g. sizing within a toolbar. */
  className?: string;
}

/**
 * The dropdown styling used by the in-game settings selects: `appearance-none`
 * over an explicit dark background plus our own chevron, so the control renders
 * the same in the dark theme instead of inheriting the browser's native
 * light-on-light select.
 */
export const styledSelect = ({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
}: StyledSelectProps): TemplateResult => html`
  <div class="relative ${className}">
    <select
      class="w-full appearance-none py-1.5 pl-3 pr-9 border border-white/20 rounded-lg bg-black/40 text-white text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
      aria-label=${ariaLabel}
      .value=${value}
      @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
    >
      ${options.map(
        (option) =>
          html`<option
            value=${option.value}
            ?selected=${option.value === value}
            class="bg-surface text-white"
          >
            ${option.label}
          </option>`,
      )}
    </select>
    <span
      class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/60"
      aria-hidden="true"
    >
      <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path
          fill-rule="evenodd"
          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08z"
          clip-rule="evenodd"
        />
      </svg>
    </span>
  </div>
`;
