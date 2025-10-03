import { html, TemplateResult } from "lit";

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
  icon: string;
  iconAlt: string;
  title: string;
  label: string;
  disabled?: boolean;
}

const ICON_SIZE =
  "h-5 w-5 shrink-0 transition-transform group-hover:scale-110 text-zinc-400";
const TEXT_SIZE =
  "text-base sm:text-[14px] leading-5 font-semibold tracking-tight";

const getButtonStyles = () => {
  const btnBase =
    "group w-full min-w-[50px] select-none flex flex-col items-center justify-center " +
    "gap-1 rounded-lg py-1.5 border border-white/10 bg-white/[0.04] shadow-sm " +
    "transition-all duration-150 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 " +
    "active:translate-y-[1px]";

  return {
    normal: `${btnBase} text-white/90 hover:bg-white/10 hover:text-white`,
    red: `${btnBase} text-red-400 hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-red-400/30`,
    green: `${btnBase} text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 focus-visible:ring-emerald-400/30`,
    yellow: `${btnBase} text-[#f59e0b] hover:bg-[#f59e0b]/10 hover:text-[#fbbf24] focus-visible:ring-[#f59e0b]/30`,
    indigo: `${btnBase} text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-300 focus-visible:ring-indigo-400/30`,
    sky: `${btnBase} text-[#38bdf8] hover:bg-[#38bdf8]/10 hover:text-[#0ea5e9] focus-visible:ring-[#38bdf8]/30`,
  };
};

export const actionButton = (props: ActionButtonProps): TemplateResult => {
  const {
    onClick,
    type = "normal",
    icon,
    iconAlt,
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
      <img src=${icon} alt=${iconAlt} aria-hidden="true" class="${ICON_SIZE}" />
      <span class="${TEXT_SIZE}">${label}</span>
    </button>
  `;
};
