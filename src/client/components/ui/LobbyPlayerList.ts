import { TemplateResult, html } from "lit";
import { GameMode } from "../../../core/game/Game";
import { ClientInfo, TeamCountConfig } from "../../../core/Schemas";
import { translateText } from "../../Utils";

interface CountLabel {
  value: number;
  singularKey: string;
  pluralKey: string;
}

export interface LobbyPlayerListProps {
  count: CountLabel;
  secondary?: CountLabel;
  teamList: LobbyTeamListProps;
  wrapperClassName?: string;
}

export interface LobbyTeamListProps {
  gameMode: GameMode;
  clients: ClientInfo[];
  lobbyCreatorClientID?: string | null;
  teamCount: TeamCountConfig;
  nationCount?: number;
  onKickPlayer?: (clientID: string) => void;
  className?: string;
}

const DEFAULT_WRAPPER_CLASS = "border-t border-white/10 pt-6";
const HEADER_CLASS =
  "text-xs font-bold text-white/40 uppercase tracking-widest";
const DEFAULT_TEAM_LIST_CLASS =
  "block rounded-lg border border-white/10 bg-white/5 p-2";

const renderCountLabel = ({
  value,
  singularKey,
  pluralKey,
}: CountLabel) => html`
  ${value}
  ${value === 1 ? translateText(singularKey) : translateText(pluralKey)}
`;

export const renderLobbyPlayerList = ({
  count,
  secondary,
  teamList,
  wrapperClassName,
}: LobbyPlayerListProps): TemplateResult => html`
  <div class="${wrapperClassName ?? DEFAULT_WRAPPER_CLASS}">
    <div class="flex justify-between items-center mb-4">
      <div class="${HEADER_CLASS}">
        ${renderCountLabel(count)}
        ${secondary
          ? html`
              <span class="mx-2">•</span>
              ${renderCountLabel(secondary)}
            `
          : ""}
      </div>
    </div>

    ${renderLobbyTeamList(teamList)}
  </div>
`;

export const renderLobbyTeamList = ({
  gameMode,
  clients,
  lobbyCreatorClientID,
  teamCount,
  nationCount,
  onKickPlayer,
  className,
}: LobbyTeamListProps): TemplateResult => html`
  <lobby-team-view
    class="${className ?? DEFAULT_TEAM_LIST_CLASS}"
    .gameMode=${gameMode}
    .clients=${clients}
    .lobbyCreatorClientID=${lobbyCreatorClientID ?? ""}
    .teamCount=${teamCount}
    .nationCount=${nationCount ?? 0}
    .onKickPlayer=${onKickPlayer}
  ></lobby-team-view>
`;
