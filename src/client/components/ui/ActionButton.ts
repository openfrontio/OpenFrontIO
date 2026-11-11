import { html, TemplateResult } from "lit";
import "../OfIcon";
import type { OfIconName } from "../OfIcon";

export type ButtonVariant =
  | "normal"
  | "red"
  | "green"
  | "indigo"
  | "yellow"
  | "sky";
export interface ActionButtonProps {
  onClick: (e: MouseEvent) => void;
  type?: ButtonVariant;
  icon: OfIconName;
  title: string;
  label: string;
  disabled?: boolean;
}

const TEXT_SIZE =
  "text-xs sm:text-[13px] leading-4 font-semibold tracking-tight text-balance";

const getButtonStyles = () => {
  const btnBase =
    "group w-full min-w-[50px] min-h-14 select-none flex flex-col items-center justify-center " +
    "gap-1 rounded-lg px-2 py-1.5 text-center border border-white/10 bg-white/6 shadow-xs " +
    "transition-all duration-150 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aquarius " +
    // A disabled button (on cooldown, already reported) is dimmed and does
    // not react to the pointer.
    "enabled:active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50";

  return {
    normal: `${btnBase} text-white/90 enabled:hover:bg-white/10 enabled:hover:text-white`,
    red: `${btnBase} text-red-400 enabled:hover:bg-red-500/10 enabled:hover:text-red-300`,
    green: `${btnBase} text-emerald-400 enabled:hover:bg-emerald-500/10 enabled:hover:text-emerald-300`,
    yellow: `${btnBase} text-[#f59e0b] enabled:hover:bg-[#f59e0b]/10 enabled:hover:text-[#fbbf24]`,
    indigo: `${btnBase} text-indigo-400 enabled:hover:bg-indigo-500/10 enabled:hover:text-indigo-300`,
    sky: `${btnBase} text-[#38bdf8] enabled:hover:bg-[#38bdf8]/10 enabled:hover:text-[#0ea5e9]`,
  };
};

export const actionButton = (props: ActionButtonProps): TemplateResult => {
  const {
    onClick,
    type = "normal",
    icon,
    title,
    label,
    disabled = false,
  } = props;
  const buttonStyles = getButtonStyles();
  const buttonClass = buttonStyles[type];

  return html`
    <button
      @click=${onClick}
      class="${buttonClass}"
      title="${title}"
      type="button"
      aria-label="${title}"
      ?disabled=${disabled}
    >
      <of-icon
        name=${icon}
        size="20"
        class="transition-transform group-enabled:group-hover:scale-110"
      ></of-icon>
      <span class="${TEXT_SIZE}">${label}</span>
    </button>
  `;
};
