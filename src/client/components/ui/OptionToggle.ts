import { TemplateResult, html } from "lit";
import { translateText } from "../../Utils";

export interface OptionToggleProps {
  labelKey: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  hidden?: boolean;
}

const BUTTON_CLASS_BASE =
  "relative p-4 rounded-xl border transition-all duration-200 flex flex-col " +
  "items-center justify-center gap-2 h-full min-h-[100px] w-full cursor-pointer";
const BUTTON_CLASS_ACTIVE =
  "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]";
const BUTTON_CLASS_IDLE =
  "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80";
const LABEL_CLASS_BASE =
  "text-xs uppercase font-bold tracking-wider text-center w-full leading-tight " +
  "break-words hyphens-auto";
const LABEL_CLASS_ACTIVE = "text-white";
const LABEL_CLASS_IDLE = "text-white/60";

export const renderOptionToggle = ({
  labelKey,
  checked,
  onToggle,
  hidden,
}: OptionToggleProps): TemplateResult => {
  if (hidden) {
    return html``;
  }

  return html`
    <button
      class="${BUTTON_CLASS_BASE} ${checked
        ? BUTTON_CLASS_ACTIVE
        : BUTTON_CLASS_IDLE}"
      type="button"
      aria-pressed=${checked}
      @click=${() => onToggle(!checked)}
    >
      <div
        class="${LABEL_CLASS_BASE} ${checked
          ? LABEL_CLASS_ACTIVE
          : LABEL_CLASS_IDLE}"
      >
        ${translateText(labelKey)}
      </div>
    </button>
  `;
};
