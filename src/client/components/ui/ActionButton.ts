import { html, TemplateResult } from "lit";

export interface ActionButtonProps {
  onClick: (e: MouseEvent) => void;
  type?: "normal" | "red" | "green" | "indigo";
  icon: string;
  iconAlt: string;
  title: string;
  label: string;
  disabled?: boolean;
}

const getButtonStyles = () => {
  const btnBase =
    "group w-full min-w-[50px] select-none flex flex-col items-center justify-center " +
    "gap-1 rounded-lg py-1.5 border border-white/10 bg-white/[0.04] shadow-sm " +
    "transition-all duration-150 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 " +
    "active:translate-y-[1px]";

  return {
    normal: `${btnBase} text-zinc-200/80 hover:bg-white/10 hover:text-white`,
    red: `${btnBase} text-red-400 hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-red-400/30`,
    green: `${btnBase} text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 focus-visible:ring-emerald-400/30`,
    indigo: `${btnBase} text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-300 focus-visible:ring-indigo-400/30`,
  };
};

const iconSize = "h-5 w-5 shrink-0 transition-transform group-hover:scale-110";
const textSize =
  "text-[10px] sm:text-[11px] leading-4 font-medium tracking-tight";

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
      ?disabled=${disabled}
    >
      <img src=${icon} alt=${iconAlt} class="${iconSize}" />
      <span class="${textSize}">${label}</span>
    </button>
  `;
};
