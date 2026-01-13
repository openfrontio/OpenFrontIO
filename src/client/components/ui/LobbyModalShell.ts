import { TemplateResult, html } from "lit";
import { translateText } from "../../Utils";
import { ModalHeaderProps, modalHeader } from "./ModalHeader";

export interface LobbyModalShellProps {
  header: ModalHeaderProps;
  content: TemplateResult;
  footer?: TemplateResult;
  inline?: boolean;
  contentClassName?: string;
  modalId?: string;
  modalTitle?: string;
}

export interface LobbyFooterButtonProps {
  label: string | TemplateResult;
  disabled?: boolean;
  onClick?: () => void;
}

export interface SectionHeaderProps {
  titleKey: string;
  icon: TemplateResult;
  iconClassName: string;
}

const SHELL_CLASS =
  "h-full flex flex-col bg-black/60 backdrop-blur-md rounded-2xl border " +
  "border-white/10 overflow-hidden select-none";
const CONTENT_CLASS_BASE = "flex-1 overflow-y-auto custom-scrollbar p-6 mr-1";
const FOOTER_CLASS = "p-6 pt-4 border-t border-white/10 bg-black/20 shrink-0";
const FOOTER_BUTTON_CLASS =
  "w-full py-4 text-sm font-bold text-white uppercase tracking-widest " +
  "bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed " +
  "rounded-xl transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 " +
  "hover:-translate-y-0.5 active:translate-y-0 disabled:transform-none";

const withClasses = (...classes: Array<string | undefined>) =>
  classes.filter(Boolean).join(" ");

export const lobbyModalShell = ({
  header,
  content,
  footer,
  inline,
  contentClassName,
  modalId,
  modalTitle,
}: LobbyModalShellProps): TemplateResult => {
  const body = html`
    <div class="${SHELL_CLASS}">
      ${modalHeader(header)}
      <div class="${withClasses(CONTENT_CLASS_BASE, contentClassName)}">
        ${content}
      </div>
      ${footer ? html`<div class="${FOOTER_CLASS}">${footer}</div>` : ""}
    </div>
  `;

  if (inline) {
    return body;
  }

  return html`
    <o-modal
      ?hideHeader=${true}
      ?hideCloseButton=${true}
      ?inline=${inline}
      id=${modalId ?? ""}
      title=${modalTitle ?? ""}
    >
      ${body}
    </o-modal>
  `;
};

export const renderLobbyFooterButton = ({
  label,
  disabled,
  onClick,
}: LobbyFooterButtonProps): TemplateResult => html`
  <button
    class="${FOOTER_BUTTON_CLASS}"
    ?disabled=${disabled ?? false}
    @click=${onClick}
    type="button"
  >
    ${label}
  </button>
`;

export const renderSectionHeader = ({
  titleKey,
  icon,
  iconClassName,
}: SectionHeaderProps): TemplateResult => html`
  <div class="flex items-center gap-4 pb-2 border-b border-white/10">
    <div
      class="w-8 h-8 rounded-lg flex items-center justify-center ${iconClassName}"
    >
      ${icon}
    </div>
    <h3 class="text-lg font-bold text-white uppercase tracking-wider">
      ${translateText(titleKey)}
    </h3>
  </div>
`;
