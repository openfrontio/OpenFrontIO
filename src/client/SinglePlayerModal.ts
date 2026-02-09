import { html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { UserMeResponse } from "../core/ApiSchemas";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  UnitType,
} from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { generateID } from "../core/Util";
import { hasLinkedAccount } from "./Api";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/GameConfigForm";
import { GameConfigForm } from "./components/GameConfigForm";
import { modalHeader } from "./components/ui/ModalHeader";
import { fetchCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { FlagInput } from "./FlagInput";
import { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";
import { PRIMARY_BUTTON } from "./utilities/ConfigCards";

@customElement("single-player-modal")
export class SinglePlayerModal extends BaseModal {
  @query("game-config-form") private configForm!: GameConfigForm;

  @state() private showAchievements: boolean = false;
  @state() private mapWins: Map<GameMapType, Set<Difficulty>> = new Map();
  @state() private userMeResponse: UserMeResponse | false = false;

  private userSettings: UserSettings = new UserSettings();

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
  }

  disconnectedCallback() {
    document.removeEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    super.disconnectedCallback();
  }

  private toggleAchievements = () => {
    this.showAchievements = !this.showAchievements;
  };

  private handleUserMeResponse = (
    event: CustomEvent<UserMeResponse | false>,
  ) => {
    this.userMeResponse = event.detail;
    this.applyAchievements(event.detail);
  };

  private renderNotLoggedInBanner() {
    if (crazyGamesSDK.isOnCrazyGames()) {
      return html``;
    }
    return html`<div
      class="px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 whitespace-nowrap shrink-0"
    >
      ${translateText("single_modal.sign_in_for_achievements")}
    </div>`;
  }

  private applyAchievements(userMe: UserMeResponse | false) {
    if (!userMe) {
      this.mapWins = new Map();
      return;
    }

    const achievements = Array.isArray(userMe.player.achievements)
      ? userMe.player.achievements
      : [];

    const completions =
      achievements.find(
        (achievement) => achievement?.type === "singleplayer-map",
      )?.data ?? [];

    const winsMap = new Map<GameMapType, Set<Difficulty>>();
    for (const entry of completions) {
      const { mapName, difficulty } = entry ?? {};
      const isValidMap =
        typeof mapName === "string" &&
        Object.values(GameMapType).includes(mapName as GameMapType);
      const isValidDifficulty =
        typeof difficulty === "string" &&
        Object.values(Difficulty).includes(difficulty as Difficulty);
      if (!isValidMap || !isValidDifficulty) continue;

      const map = mapName as GameMapType;
      const set = winsMap.get(map) ?? new Set<Difficulty>();
      set.add(difficulty as Difficulty);
      winsMap.set(map, set);
    }

    this.mapWins = winsMap;
  }

  render() {
    const content = html`
      <div
        class="h-full flex flex-col bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden"
      >
        <!-- Header -->
        ${modalHeader({
          title: translateText("main.solo") || "Solo",
          onBack: this.close,
          ariaLabel: translateText("common.back"),
          rightContent: hasLinkedAccount(this.userMeResponse)
            ? html`<button
                @click=${this.toggleAchievements}
                class="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all shrink-0 ${this
                  .showAchievements
                  ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                  : "text-white/60"}"
              >
                <img
                  src="/images/MedalIconWhite.svg"
                  class="w-4 h-4 opacity-80 shrink-0"
                  style="${this.showAchievements
                    ? ""
                    : "filter: grayscale(1);"}"
                />
                <span
                  class="text-xs font-bold uppercase tracking-wider whitespace-nowrap"
                  >${translateText("single_modal.toggle_achievements")}</span
                >
              </button>`
            : this.renderNotLoggedInBanner(),
        })}

        <!-- Scrollable Content -->
        <div
          class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-4 pb-6 mr-1"
        >
          <game-config-form
            variant="singleplayer"
            .showAchievements=${this.showAchievements}
            .mapWins=${this.mapWins}
          ></game-config-form>
        </div>

        <!-- Footer Action -->
        <div class="p-6 border-t border-white/10 bg-black/20">
          ${hasLinkedAccount(this.userMeResponse) &&
          this.configForm?.hasOptionsChanged()
            ? html`<div
                class="mb-4 px-4 py-3 rounded-xl bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-bold uppercase tracking-wider text-center"
              >
                ${translateText("single_modal.options_changed_no_achievements")}
              </div>`
            : null}
          <button @click=${this.startGame} class="${PRIMARY_BUTTON}">
            ${translateText("single_modal.start")}
          </button>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="singlePlayerModal"
        title="${translateText("main.solo") || "Solo"}"
        ?inline=${this.inline}
        hideHeader
        hideCloseButton
      >
        ${content}
      </o-modal>
    `;
  }

  protected onClose(): void {
    this.configForm?.reset();
  }

  private async startGame() {
    const config = this.configForm.getConfig();

    // Validate max timer
    let finalMaxTimerValue: number | undefined = undefined;
    if (config.maxTimer) {
      if (!config.maxTimerValue || config.maxTimerValue <= 0) {
        console.error("Max timer is enabled but no valid value is set");
        alert(
          translateText("single_modal.max_timer_invalid") ||
            "Please enter a valid max timer value (1-120 minutes)",
        );
        return;
      }
      finalMaxTimerValue = Math.max(1, Math.min(120, config.maxTimerValue));
    }

    // Resolve the map (handles random map selection)
    const selectedMap = this.configForm.resolveSelectedMap();

    console.log(
      `Starting single player game with map: ${GameMapType[selectedMap as keyof typeof GameMapType]}${config.useRandomMap ? " (Randomly selected)" : ""}`,
    );
    const clientID = generateID();
    const gameID = generateID();

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!usernameInput) {
      console.warn("Username input element not found");
    }

    const flagInput = document.querySelector("flag-input") as FlagInput;
    if (!flagInput) {
      console.warn("Flag input element not found");
    }
    const cosmetics = await fetchCosmetics();
    let selectedPattern = this.userSettings.getSelectedPatternName(cosmetics);
    selectedPattern ??= cosmetics
      ? (this.userSettings.getDevOnlyPattern() ?? null)
      : null;

    const selectedColor = this.userSettings.getSelectedColor();

    await crazyGamesSDK.requestMidgameAd();

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          clientID: clientID,
          gameID: gameID,
          gameStartInfo: {
            gameID: gameID,
            players: [
              {
                clientID,
                username: usernameInput.getCurrentUsername(),
                cosmetics: {
                  flag:
                    flagInput.getCurrentFlag() === "xx"
                      ? ""
                      : flagInput.getCurrentFlag(),
                  pattern: selectedPattern ?? undefined,
                  color: selectedColor ? { color: selectedColor } : undefined,
                },
              },
            ],
            config: {
              gameMap: selectedMap,
              gameMapSize: config.compactMap
                ? GameMapSize.Compact
                : GameMapSize.Normal,
              gameType: GameType.Singleplayer,
              gameMode: config.gameMode,
              playerTeams: config.teamCount,
              difficulty: config.selectedDifficulty,
              maxTimerValue: finalMaxTimerValue,
              bots: config.bots,
              infiniteGold: config.infiniteGold,
              donateGold: config.gameMode === GameMode.Team,
              donateTroops: config.gameMode === GameMode.Team,
              infiniteTroops: config.infiniteTroops,
              instantBuild: config.instantBuild,
              randomSpawn: config.randomSpawn,
              disabledUnits: config.disabledUnits
                .map((u) => Object.values(UnitType).find((ut) => ut === u))
                .filter((ut): ut is UnitType => ut !== undefined),
              ...(config.gameMode === GameMode.Team &&
              config.teamCount === HumansVsNations
                ? {
                    disableNations: false,
                  }
                : {
                    disableNations: config.disableNations,
                  }),
              ...(config.goldMultiplier && config.goldMultiplierValue
                ? { goldMultiplier: config.goldMultiplierValue }
                : {}),
              ...(config.startingGold && config.startingGoldValue !== undefined
                ? { startingGold: config.startingGoldValue }
                : {}),
            },
            lobbyCreatedAt: Date.now(),
          },
          source: "singleplayer",
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }
}
