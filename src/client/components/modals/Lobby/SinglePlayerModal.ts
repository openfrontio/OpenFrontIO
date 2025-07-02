// shared/SinglePlayerModal.ts
import { html } from "lit";
import { customElement } from "lit/decorators.js";
import { consolex } from "../../../../core/Consolex";
import { GameMapType, GameType, UnitType } from "../../../../core/game/Game";
import { generateID } from "../../../../core/Util";
import { JoinLobbyEvent } from "../../../Main";
import { translateText } from "../../../Utils";
import { UsernameInput } from "../../UsernameInput";
import { FlagSelectionModal } from "../FlagSelectionModal";
import { BaseGameSetupModal } from "./BaseGameSetupModal";
import { Step } from "./GameSetupComponents";

@customElement("single-player-modal")
export class SinglePlayerModal extends BaseGameSetupModal {
  protected steps: Step[] = ["map", "difficulty", "mode", "options"];
  protected isSinglePlayer = true;

  protected getModalTitle(): string {
    return translateText("single_modal.title");
  }

  protected initialize() {
    this.gameSetupConfig.useRandomMap = false;
  }

  protected cleanup() {
    // No-op for single-player
  }

  protected handleStartGame() {
    if (this.gameSetupConfig.useRandomMap) {
      this.gameSetupConfig.selectedMap = this.getRandomMap();
    }
    consolex.log(
      `Starting single player game with map: ${GameMapType[this.gameSetupConfig.selectedMap]}${this.gameSetupConfig.useRandomMap ? " (Randomly selected)" : ""}`,
    );
    const clientID = generateID();
    const gameID = generateID();

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!usernameInput) {
      consolex.warn("Username input element not found");
    }

    const flagSelectionModal = document.querySelector(
      "flag-modal",
    ) as FlagSelectionModal;
    if (!flagSelectionModal) {
      consolex.warn("Flag input element not found");
    }

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
                username: usernameInput?.getCurrentUsername() ?? "",
                flag:
                  flagSelectionModal?.getCurrentFlag() === "xx"
                    ? ""
                    : (flagSelectionModal?.getCurrentFlag() ?? ""),
              },
            ],
            config: {
              gameMap: this.gameSetupConfig.selectedMap,
              gameType: GameType.Singleplayer,
              gameMode: this.gameSetupConfig.gameMode,
              playerTeams: this.gameSetupConfig.teamCount,
              difficulty: this.gameSetupConfig.selectedDifficulty,
              disableNPCs: this.gameSetupConfig.disableNPCs,
              bots: this.gameSetupConfig.bots,
              infiniteGold: this.gameSetupConfig.infiniteGold,
              infiniteTroops: this.gameSetupConfig.infiniteTroops,
              instantBuild: this.gameSetupConfig.instantBuild,
              disabledUnits: this.gameSetupConfig.disabledUnits
                .map((u) => Object.values(UnitType).find((ut) => ut === u))
                .filter((ut): ut is UnitType => ut !== undefined),
            },
          },
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }

  protected isStartGameDisabled(): boolean {
    return false; // Single-player can always start
  }

  protected renderLobbyIdSection() {
    return html``; // No lobby ID for single-player
  }
}
