import { TemplateResult, html } from "lit";
import {
  Duos,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../../../core/game/Game";
import { TeamCountConfig } from "../../../core/Schemas";
import { translateText } from "../../Utils";
import { renderSectionHeader } from "./LobbyModalShell";

export interface GameModeSectionProps {
  gameMode: GameMode;
  teamCount: TeamCountConfig;
  onSelectMode: (mode: GameMode) => void;
  onSelectTeamCount: (count: TeamCountConfig) => void;
}

const MODE_GRID_CLASS = "grid grid-cols-2 gap-4";
const MODE_BUTTON_CLASS_BASE =
  "w-full py-6 rounded-xl border transition-all duration-200 flex flex-col " +
  "items-center justify-center gap-3";
const MODE_BUTTON_CLASS_ACTIVE =
  "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]";
const MODE_BUTTON_CLASS_IDLE =
  "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20";
const MODE_LABEL_CLASS =
  "text-sm font-bold text-white uppercase tracking-widest break-words hyphens-auto";
const TEAM_TITLE_CLASS =
  "text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2";
const TEAM_GRID_CLASS = "grid grid-cols-2 md:grid-cols-5 gap-3";
const TEAM_BUTTON_CLASS_BASE =
  "w-full px-4 py-3 rounded-xl border transition-all duration-200 flex " +
  "items-center justify-center";
const TEAM_BUTTON_CLASS_ACTIVE =
  "bg-blue-500/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]";
const TEAM_BUTTON_CLASS_IDLE =
  "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20";
const TEAM_LABEL_CLASS =
  "text-xs font-bold uppercase tracking-wider text-center text-white " +
  "break-words hyphens-auto";

const TEAM_OPTIONS: TeamCountConfig[] = [
  2,
  3,
  4,
  5,
  6,
  7,
  Quads,
  Trios,
  Duos,
  HumansVsNations,
];

const getModeLabel = (mode: GameMode) =>
  mode === GameMode.FFA
    ? translateText("game_mode.ffa")
    : translateText("game_mode.teams");

const getTeamLabel = (option: TeamCountConfig) =>
  typeof option === "string"
    ? option === HumansVsNations
      ? translateText("public_lobby.teams_hvn")
      : translateText(`host_modal.teams_${option}`)
    : translateText("public_lobby.teams", { num: option });

export const renderGameModeSection = ({
  gameMode,
  teamCount,
  onSelectMode,
  onSelectTeamCount,
}: GameModeSectionProps): TemplateResult => html`
  <div class="space-y-6">
    ${renderSectionHeader({
      titleKey: "host_modal.mode",
      iconClassName: "bg-purple-500/20 text-purple-400",
      icon: html`
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="w-5 h-5"
        >
          <path
            d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 18.75c1.995 0 3.823.707 5.25 1.886V4.533zM12.75 20.636A8.214 8.214 0 0118 18.75c.966 0 1.89.166 2.75.47a.75.75 0 001-.708V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533v16.103z"
          />
        </svg>
      `,
    })}

    <div class="${MODE_GRID_CLASS}">
      ${[GameMode.FFA, GameMode.Team].map((mode) => {
        const isSelected = gameMode === mode;
        return html`
          <button
            class="${MODE_BUTTON_CLASS_BASE} ${isSelected
              ? MODE_BUTTON_CLASS_ACTIVE
              : MODE_BUTTON_CLASS_IDLE}"
            @click=${() => onSelectMode(mode)}
          >
            <span class="${MODE_LABEL_CLASS}">${getModeLabel(mode)}</span>
          </button>
        `;
      })}
    </div>
  </div>
  ${gameMode === GameMode.FFA
    ? html``
    : html`
        <div class="space-y-6">
          <div class="${TEAM_TITLE_CLASS}">
            ${translateText("host_modal.team_count")}
          </div>
          <div class="${TEAM_GRID_CLASS}">
            ${TEAM_OPTIONS.map((option) => {
              const isSelected = teamCount === option;
              return html`
                <button
                  @click=${() => onSelectTeamCount(option)}
                  class="${TEAM_BUTTON_CLASS_BASE} ${isSelected
                    ? TEAM_BUTTON_CLASS_ACTIVE
                    : TEAM_BUTTON_CLASS_IDLE}"
                >
                  <span class="${TEAM_LABEL_CLASS}">
                    ${getTeamLabel(option)}
                  </span>
                </button>
              `;
            })}
          </div>
        </div>
      `}
`;
