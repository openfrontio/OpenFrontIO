// shared/BaseGameSetupModal.ts
import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { Difficulty, GameMapType, GameMode } from "../../../../core/game/Game";
import { GameSetupConfig, Step } from "./GameSetupComponents";

import "./Difficulties";
import "./GameSetupComponents";
import "./Maps";

@customElement("base-game-setup-modal")
export abstract class BaseGameSetupModal extends LitElement {
  @query("o-modal") protected modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() protected gameSetupConfig: GameSetupConfig = {
    selectedMap: GameMapType.World,
    selectedDifficulty: Difficulty.Medium,
    disableNPCs: false,
    gameMode: GameMode.FFA,
    teamCount: 2,
    bots: 400,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    useRandomMap: false,
    disabledUnits: [],
  };

  @state() protected currentStep: Step = "map";
  protected abstract steps: Step[];
  protected abstract isSinglePlayer: boolean; //property to distinguish modal type

  createRenderRoot() {
    return this;
  }

  public open() {
    this.modalEl?.open();
    this.initialize();
    this.requestUpdate();
  }

  public close() {
    this.modalEl?.close();
  }
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("modal-close", () => {
      this.cleanup();
    });
  }

  protected initialize() {
    // Hook for subclasses to initialize (e.g., lobby creation, reset state)
  }

  protected cleanup() {
    // Hook for subclasses to clean up (e.g., clear intervals)
  }

  protected abstract getModalTitle(): string;
  protected abstract handleStartGame(): void;
  protected abstract isStartGameDisabled(): boolean;
  protected abstract renderLobbyIdSection(): unknown;

  protected setCurrentStep(e: CustomEvent) {
    this.currentStep = e.detail.step;
  }

  protected handleMapChange(e: CustomEvent) {
    const { selectedMap, useRandomMap } = e.detail;
    this.gameSetupConfig = {
      ...this.gameSetupConfig,
      selectedMap: selectedMap || this.gameSetupConfig.selectedMap,
      useRandomMap:
        useRandomMap !== undefined
          ? useRandomMap
          : this.gameSetupConfig.useRandomMap,
    };
    this.onConfigChange();
  }

  protected handleDifficultyChange(e: CustomEvent) {
    this.gameSetupConfig = {
      ...this.gameSetupConfig,
      selectedDifficulty: e.detail.selectedDifficulty,
    };
    this.onConfigChange();
  }

  protected handleGameModeChange(e: CustomEvent) {
    this.gameSetupConfig = {
      ...this.gameSetupConfig,
      gameMode: e.detail.gameMode,
    };
    this.onConfigChange();
  }

  protected handleTeamCountChange(e: CustomEvent) {
    this.gameSetupConfig = {
      ...this.gameSetupConfig,
      teamCount: e.detail.teamCount,
    };
    this.onConfigChange();
  }

  protected handleOptionsChange(e: CustomEvent) {
    this.gameSetupConfig = {
      ...this.gameSetupConfig,
      ...e.detail,
    };
    this.onConfigChange();
  }

  protected handleNext() {
    const currentIndex = this.steps.indexOf(this.currentStep);
    if (currentIndex < this.steps.length - 1) {
      this.currentStep = this.steps[currentIndex + 1];
    }
  }

  protected handleBack() {
    const currentIndex = this.steps.indexOf(this.currentStep);
    if (currentIndex > 0) {
      this.currentStep = this.steps[currentIndex - 1];
    }
  }

  protected getRandomMap(): GameMapType {
    const maps = Object.values(GameMapType);
    const randIdx = Math.floor(Math.random() * maps.length);
    return maps[randIdx] as GameMapType;
  }

  protected onConfigChange() {
    // Hook for subclasses to react to config changes (e.g., update server)
  }

  protected getPlayers(): string[] {
    return []; // Default implementation, overridden by HostLobbyModal
  }

  protected renderStepContent() {
    switch (this.currentStep) {
      case "map":
        return html`
          <map-selection
            .selectedMap=${this.gameSetupConfig.selectedMap}
            .useRandomMap=${this.gameSetupConfig.useRandomMap}
            @map-change=${this.handleMapChange}
          ></map-selection>
        `;
      case "difficulty":
        return html`
          <difficulty-selection
            .selectedDifficulty=${this.gameSetupConfig.selectedDifficulty}
            @difficulty-change=${this.handleDifficultyChange}
          ></difficulty-selection>
        `;
      case "mode":
        return html`
          <game-mode-selection
            .gameMode=${this.gameSetupConfig.gameMode}
            .teamCount=${this.gameSetupConfig.teamCount}
            @game-mode-change=${this.handleGameModeChange}
            @team-count-change=${this.handleTeamCountChange}
          ></game-mode-selection>
        `;
      case "options":
        return html`
          <game-options
            .bots=${this.gameSetupConfig.bots}
            .disableNPCs=${this.gameSetupConfig.disableNPCs}
            .instantBuild=${this.gameSetupConfig.instantBuild}
            .infiniteGold=${this.gameSetupConfig.infiniteGold}
            .infiniteTroops=${this.gameSetupConfig.infiniteTroops}
            .disabledUnits=${this.gameSetupConfig.disabledUnits}
            .isSinglePlayer=${this.isSinglePlayer}
            @options-change=${this.handleOptionsChange}
          ></game-options>
        `;
      case "waiting":
        return html`
          <game-setup-waiting
            .players=${this.getPlayers()}
          ></game-setup-waiting>
        `;
    }
  }

  render() {
    return html`
      <o-modal
        .disableContentScroll=${true}
        width="large"
        title=${this.getModalTitle()}
      >
        <!-- Progress Steps -->
        <game-setup-progress
          .currentStep=${this.currentStep}
          .hideWaiting=${this.isSinglePlayer}
          @step-change=${this.setCurrentStep}
        ></game-setup-progress>

        <div class="bg-backgroundDark backdrop-blur-sm text-textLight">
          <!-- Step Content -->
          <div class="max-h-100 overflow-y-auto mb-6">
            ${this.renderStepContent()}
          </div>

          <!-- Navigation -->
          <div
            class="flex items-center justify-between p-6 border-t border-textGrey sticky bottom-0 sm:static bg-backgroundDark"
          >
            <o-button
              .title=${"Back"}
              .icon=${"icons/chevron-left.svg"}
              translationKey="host_modal.back"
              @click=${this.handleBack}
              ?disable=${this.currentStep === "map"}
              class="${this.currentStep === "map" ||
              this.currentStep === "waiting"
                ? "opacity-50 cursor-not-allowed"
                : ""}  sm:w-auto"
            ></o-button>

            ${this.renderLobbyIdSection()}

            <o-button
              .title=${this.currentStep === this.steps[this.steps.length - 1]
                ? this.isStartGameDisabled()
                  ? "Waiting for players..."
                  : "Start Game"
                : "Next"}
              .icon=${this.currentStep === this.steps[this.steps.length - 1]
                ? ""
                : "icons/chevron-right.svg"}
              iconPosition="right"
              translationKey="host_modal.next"
              @click=${this.currentStep === this.steps[this.steps.length - 1]
                ? this.handleStartGame
                : this.handleNext}
              ?disable=${this.isStartGameDisabled()}
              ?secondary=${false}
              class=" sm:w-auto"
            ></o-button>
          </div>
        </div>
      </o-modal>
    `;
  }
}
