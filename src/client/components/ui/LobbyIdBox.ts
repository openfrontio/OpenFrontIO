import { TemplateResult, html } from "lit";

export interface LobbyIdBoxProps {
  lobbyId: string;
  isVisible: boolean;
  copySuccess: boolean;
  onToggleVisibility: () => void;
  onCopy: () => void;
  toggleTitle: string;
  copyTitle: string;
  copiedLabel: string;
}

const WRAPPER_CLASS =
  "flex items-center gap-0.5 bg-white/5 rounded-lg px-2 py-1 border " +
  "border-white/10 max-w-[220px] flex-nowrap";
const ICON_BUTTON_CLASS =
  "p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white " +
  "transition-colors";
const VALUE_BUTTON_CLASS =
  "font-mono text-xs font-bold text-white px-2 cursor-pointer select-none " +
  "min-w-[80px] text-center truncate tracking-wider bg-transparent border-0";

const ICON_VISIBLE = html`
  <svg viewBox="0 0 512 512" height="16px" width="16px" fill="currentColor">
    <path
      d="M256 105c-101.8 0-188.4 62.7-224 151 35.6 88.3 122.2 151 224 151s188.4-62.7 224-151c-35.6-88.3-122.2-151-224-151zm0 251.7c-56 0-101.7-45.7-101.7-101.7S200 153.3 256 153.3 357.7 199 357.7 255 312 356.7 256 356.7zm0-161.1c-33 0-59.4 26.4-59.4 59.4s26.4 59.4 59.4 59.4 59.4-26.4 59.4-59.4-26.4-59.4-59.4-59.4z"
    ></path>
  </svg>
`;
const ICON_HIDDEN = html`
  <svg viewBox="0 0 512 512" height="16px" width="16px" fill="currentColor">
    <path
      d="M448 256s-64-128-192-128S64 256 64 256c32 64 96 128 192 128s160-64 192-128z"
      fill="none"
      stroke="currentColor"
      stroke-width="32"
    ></path>
    <path
      d="M144 256l224 0"
      fill="none"
      stroke="currentColor"
      stroke-width="32"
      stroke-linecap="round"
    ></path>
  </svg>
`;
const ICON_COPY = html`
  <svg
    viewBox="0 0 24 24"
    height="16px"
    width="16px"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
    />
  </svg>
`;

export const renderLobbyIdBox = ({
  lobbyId,
  isVisible,
  copySuccess,
  onToggleVisibility,
  onCopy,
  toggleTitle,
  copyTitle,
  copiedLabel,
}: LobbyIdBoxProps): TemplateResult => html`
  <div class="${WRAPPER_CLASS}">
    <button
      @click=${onToggleVisibility}
      class="${ICON_BUTTON_CLASS}"
      title="${toggleTitle}"
      type="button"
    >
      ${isVisible ? ICON_VISIBLE : ICON_HIDDEN}
    </button>
    <button
      @click=${onCopy}
      @dblclick=${(e: Event) => {
        (e.currentTarget as HTMLElement).classList.add("select-all");
      }}
      @mouseleave=${(e: Event) => {
        (e.currentTarget as HTMLElement).classList.remove("select-all");
      }}
      class="${VALUE_BUTTON_CLASS}"
      title="${copyTitle}"
      aria-label="${copyTitle}"
      type="button"
    >
      ${copySuccess ? copiedLabel : isVisible ? lobbyId : "••••••••"}
    </button>
    <button
      @click=${onCopy}
      class="${ICON_BUTTON_CLASS}"
      title="${copyTitle}"
      aria-label="${copyTitle}"
      type="button"
    >
      ${ICON_COPY}
    </button>
  </div>
`;
