import { TemplateResult, html } from "lit";
import { renderSectionHeader } from "./LobbyModalShell";
import { renderOptionToggle } from "./OptionToggle";

export interface GameOptionsToggle {
  labelKey: string;
  checked: boolean;
  hidden?: boolean;
  onToggle: (checked: boolean) => void;
}

export interface GameOptionsSectionProps {
  titleKey: string;
  botsValue: number;
  botsMin: number;
  botsMax: number;
  botsStep: number;
  botsLabelKey: string;
  botsDisabledKey: string;
  onBotsChange: (event: Event) => void;
  toggles: GameOptionsToggle[];
  extraCards?: TemplateResult[];
}

const BOT_CARD_CLASS_BASE =
  "col-span-2 rounded-xl p-4 flex flex-col justify-center min-h-[100px] " +
  "border transition-all duration-200";
const BOT_CARD_CLASS_ACTIVE =
  "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]";
const BOT_CARD_CLASS_IDLE =
  "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 opacity-80";
const GRID_CLASS = "grid grid-cols-2 lg:grid-cols-4 gap-4";

export const renderGameOptionsSection = ({
  titleKey,
  botsValue,
  botsMin,
  botsMax,
  botsStep,
  botsLabelKey,
  botsDisabledKey,
  onBotsChange,
  toggles,
  extraCards,
}: GameOptionsSectionProps): TemplateResult => {
  const botsCardClass =
    botsValue > 0 ? BOT_CARD_CLASS_ACTIVE : BOT_CARD_CLASS_IDLE;
  const cards = [
    html`
      <div class="${BOT_CARD_CLASS_BASE} ${botsCardClass}">
        <fluent-slider
          min=${String(botsMin)}
          max=${String(botsMax)}
          step=${String(botsStep)}
          .value=${botsValue}
          labelKey=${botsLabelKey}
          disabledKey=${botsDisabledKey}
          @value-changed=${onBotsChange}
        ></fluent-slider>
      </div>
    `,
    ...toggles.map(({ labelKey, checked, onToggle, hidden }) =>
      renderOptionToggle({ labelKey, checked, onToggle, hidden }),
    ),
    ...(extraCards ?? []),
  ];

  return html`
    <div class="space-y-6">
      ${renderSectionHeader({
        titleKey,
        iconClassName: "bg-orange-500/20 text-orange-400",
        icon: html`
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            class="w-5 h-5"
          >
            <path
              fill-rule="evenodd"
              d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 00-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 00-2.282.819l-.922 1.597a1.875 1.875 0 00.432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 000 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 00-.432 2.385l.922 1.597a1.875 1.875 0 002.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 002.28-.819l.922-1.597a1.875 1.875 0 00-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 000-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 00-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 00-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 00-1.85-1.567h-1.843zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
              clip-rule="evenodd"
            />
          </svg>
        `,
      })}

      <div class="${GRID_CLASS}">${cards}</div>
    </div>
  `;
};
