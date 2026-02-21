import { html, TemplateResult } from "lit";

export interface ModalHeaderProps {
  title?: string | TemplateResult;
  titleContent?: TemplateResult;
  onBack: (event: MouseEvent) => void;
  ariaLabel?: string;
  rightContent?: TemplateResult;
  leftClassName?: string;
  buttonClassName?: string;
  titleClassName?: string;
  padded?: boolean;
  showDivider?: boolean;
}

const DEFAULT_WRAPPER_CLASS = "flex flex-wrap items-center gap-2 shrink-0";
const DEFAULT_DIVIDER_CLASS = "border-b border-white/10";
const DEFAULT_PADDING_CLASS = "p-4 lg:p-6";
const DEFAULT_LEFT_CLASS = "flex items-center gap-4 flex-1";
const DEFAULT_BUTTON_CLASS =
  "group flex items-center justify-center w-10 h-10 rounded-full shrink-0 " +
  "bg-white/5 hover:bg-white/10 transition-all border border-white/10";
const DEFAULT_TITLE_CLASS =
  "text-white text-xl lg:text-2xl font-bold uppercase " +
  "tracking-widest break-words hyphens-auto";

const withClasses = (...classes: Array<string | undefined>) =>
  classes.filter(Boolean).join(" ");

export const modalHeader = ({
  title,
  titleContent,
  onBack,
  ariaLabel = "Back",
  rightContent,
  leftClassName,
  buttonClassName,
  titleClassName,
  padded = true,
  showDivider = true,
}: ModalHeaderProps): TemplateResult => {
  const wrapperClass = withClasses(
    DEFAULT_WRAPPER_CLASS,
    showDivider ? DEFAULT_DIVIDER_CLASS : undefined,
    padded ? DEFAULT_PADDING_CLASS : undefined,
  );
  const leftClass = withClasses(DEFAULT_LEFT_CLASS, leftClassName);
  const buttonClass = withClasses(DEFAULT_BUTTON_CLASS, buttonClassName);
  const resolvedTitleClass = withClasses(DEFAULT_TITLE_CLASS, titleClassName);

  return html`
    <div class="${wrapperClass}">
      <div class="${leftClass}">
        <button
          @click=${onBack}
          class="${buttonClass}"
          aria-label="${ariaLabel}"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-5 h-5 text-gray-400 group-hover:text-white transition-colors"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
        </button>
        ${titleContent ??
        html`<span class="${resolvedTitleClass}">${title}</span>`}
      </div>
      ${rightContent ?? ""}
    </div>
  `;
};
