import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { GameType } from "../core/game/Game";
import { generateID } from "../core/Util";
import { BaseGameModal } from "./components/baseComponents/BaseGameModal";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./components/Difficulties";
import "./components/Maps";
import { FlagInput } from "./FlagInput";
import { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";
import { translateText } from "./Utils";

@customElement("single-player-modal")
export class SinglePlayerModal extends BaseGameModal {
  protected getTranslationPrefix(): string {
    return "single_modal";
  }

  protected override startGame() {
    if (this.useRandomMap) {
      this.selectedMap = this.getRandomMap();
    }

    const clientID = generateID();
    const gameID = generateID();

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    const flagInput = document.querySelector("flag-input") as FlagInput;

    const username = usernameInput?.getCurrentUsername?.() ?? "Player";
    const flag = flagInput?.getCurrentFlag?.() ?? "xx";

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          clientID,
          gameID,
          gameStartInfo: {
            gameID,
            players: [
              {
                clientID,
                username,
                flag: flag === "xx" ? "" : flag,
              },
            ],
            config: {
              gameMap: this.selectedMap,
              gameType: GameType.Singleplayer,
              gameMode: this.gameMode,
              playerTeams: this.teamCount,
              difficulty: this.selectedDifficulty,
              disableNPCs: this.gameOptions["disableNPCs"],
              bots: this.gameOptions["bots"],
              infiniteGold: this.gameOptions["infiniteGold"],
              infiniteTroops: this.gameOptions["infiniteTroops"],
              instantBuild: this.gameOptions["instantBuild"],
              disabledUnits: this.disabledUnits,
            },
          },
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );

    this.close();
  }

  protected override render() {
    return html`
      <o-modal title=${translateText("single_modal.title")}>
        <div class="options-layout">
          ${this.renderMapSelection()} ${this.renderDifficultySelection()}
          ${this.renderGameModeSelection()}
          ${this.renderTeamSelectionIfApplicable()} ${this.renderGameOptions()}
        </div>

        <o-button
          title=${translateText("single_modal.start")}
          @click=${this.startGame}
          blockDesktop
        ></o-button>
      </o-modal>
    `;
  }

  protected override createRenderRoot() {
    return this;
  }
}
