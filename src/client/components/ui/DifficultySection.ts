import { TemplateResult, html } from "lit";
import { Difficulty } from "../../../core/game/Game";
import { translateText } from "../../Utils";
import { renderSectionHeader } from "./LobbyModalShell";

export interface DifficultySectionProps {
  selectedDifficulty: Difficulty;
  disableNations: boolean;
  onSelectDifficulty: (difficulty: Difficulty) => void;
}

const DIFFICULTY_GRID_CLASS = "grid grid-cols-2 md:grid-cols-4 gap-4";
const BUTTON_CLASS_BASE =
  "relative group rounded-xl border transition-all duration-200 w-full " +
  "overflow-hidden flex flex-col items-center p-4 gap-3";
const BUTTON_CLASS_DISABLED =
  "opacity-30 grayscale cursor-not-allowed bg-white/5 border-white/5";
const BUTTON_CLASS_SELECTED =
  "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]";
const BUTTON_CLASS_IDLE =
  "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20";
const LABEL_CLASS =
  "text-xs font-bold text-white uppercase tracking-wider text-center w-full " +
  "mt-1 break-words hyphens-auto";

const DIFFICULTY_OPTIONS = Object.entries(Difficulty).filter(([key]) =>
  isNaN(Number(key)),
) as Array<[string, Difficulty]>;

export const renderDifficultySection = ({
  selectedDifficulty,
  disableNations,
  onSelectDifficulty,
}: DifficultySectionProps): TemplateResult => html`
  <div class="space-y-6">
    ${renderSectionHeader({
      titleKey: "difficulty.difficulty",
      iconClassName: "bg-green-500/20 text-green-400",
      icon: html`
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="w-5 h-5"
        >
          <path
            fill-rule="evenodd"
            d="M12.97 3.97a.75.75 0 011.06 0l7.5 7.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 11-1.06-1.06l6.22-6.22H3a.75.75 0 010-1.5h16.19l-6.22-6.22a.75.75 0 010-1.06z"
            clip-rule="evenodd"
          />
        </svg>
      `,
    })}

    <div class="${DIFFICULTY_GRID_CLASS}">
      ${DIFFICULTY_OPTIONS.map(([key, value]) => {
        const isSelected = selectedDifficulty === value;
        const isDisabled = disableNations;
        return html`
          <button
            ?disabled=${isDisabled}
            @click=${() => !isDisabled && onSelectDifficulty(value)}
            class="${BUTTON_CLASS_BASE} ${isDisabled
              ? BUTTON_CLASS_DISABLED
              : isSelected
                ? BUTTON_CLASS_SELECTED
                : BUTTON_CLASS_IDLE}"
          >
            <difficulty-display
              .difficultyKey=${key}
              class="transform scale-125 origin-center ${isDisabled
                ? "pointer-events-none"
                : ""}"
            ></difficulty-display>
            <div class="${LABEL_CLASS}">
              ${translateText(`difficulty.${key.toLowerCase()}`)}
            </div>
          </button>
        `;
      })}
    </div>
  </div>
`;
