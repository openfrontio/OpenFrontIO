import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { consolex } from "../core/Consolex";
import { Difficulty, GameMapType, GameType } from "../core/game/Game";
import { generateID } from "../core/Util";
import "./components/Difficulties";
import { DifficultyDescription } from "./components/Difficulties";
import "./components/Maps";

@customElement("single-player-modal")
export class SinglePlayerModal extends LitElement {
  @state() private isModalOpen = false;
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private selectedDifficulty: Difficulty = Difficulty.Medium;
  @state() private disableNPCs: boolean = false;
  @state() private bots: number = 400;
  @state() private infiniteGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private instantBuild: boolean = false;

  static styles = css`
    .modal-overlay {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      overflow-y: auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-content {
      background-color: rgb(35 35 35 / 0.8);
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
      color: white;
      padding: 20px;
      border-radius: 8px;
      width: 80%;
      max-width: 1280px;
      max-height: 80vh;
      overflow-y: auto;
      text-align: center;
      box-shadow: 0 0 40px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(8px);
      position: relative;
    }

    /* Add custom scrollbar styles */
    .modal-content::-webkit-scrollbar {
      width: 8px;
    }

    .modal-content::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.1);
      border-radius: 4px;
    }

    .modal-content::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 4px;
    }

    .modal-content::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .title {
      font-size: 28px;
      color: #fff;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 0 0 20px;
    }

    .close {
      color: #aaa;
      float: right;
      font-size: 28px;
      font-weight: bold;
      cursor: pointer;
    }

    .close:hover,
    .close:focus {
      color: white;
      text-decoration: none;
      cursor: pointer;
    }

    .start-game-button {
      width: 100%;
      max-width: 300px;
      padding: 15px 20px;
      font-size: 16px;
      cursor: pointer;
      background-color: #007bff;
      color: white;
      border: none;
      border-radius: 8px;
      transition: background-color 0.3s;
      display: inline-block;
      margin: 0 0 20px 0;
    }

    .start-game-button:not(:disabled):hover {
      background-color: #0056b3;
    }

    .start-game-button:disabled {
      background: linear-gradient(to right, #4a4a4a, #3d3d3d);
      opacity: 0.7;
      cursor: not-allowed;
    }

    .options-layout {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
      margin: 24px 0;
    }

    .options-section {
      background: rgba(0, 0, 0, 0.2);
      padding: 12px 24px 24px 24px;
      border-radius: 12px;
    }

    .option-title {
      margin: 0 0 16px 0;
      font-size: 20px;
      color: #fff;
      text-align: center;
    }

    .option-cards {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: center;
      gap: 16px;
    }

    .option-card {
      width: 100%;
      min-width: 100px;
      max-width: 120px;
      padding: 4px 4px 0 4px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      background: rgba(30, 30, 30, 0.95);
      border: 2px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease-in-out;
    }

    .option-card:hover {
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.3);
      background: rgba(40, 40, 40, 0.95);
    }

    .option-card.selected {
      border-color: #4a9eff;
      background: rgba(74, 158, 255, 0.1);
    }

    .option-card-title {
      font-size: 14px;
      color: #aaa;
      text-align: center;
      margin: 0 0 4px 0;
    }

    .option-image {
      width: 100%;
      aspect-ratio: 4/2;
      color: #aaa;
      transition: transform 0.2s ease-in-out;
      border-radius: 8px;
      background-color: rgba(255, 255, 255, 0.1);
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .option-card input[type="checkbox"] {
      display: none;
    }

    label.option-card:hover {
      transform: none;
    }

    .checkbox-icon {
      width: 16px;
      height: 16px;
      border: 2px solid #aaa;
      border-radius: 6px;
      margin: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease-in-out;
    }

    .option-card.selected .checkbox-icon {
      border-color: #4a9eff;
      background: #4a9eff;
    }

    .option-card.selected .checkbox-icon::after {
      content: "✓";
      color: white;
    }

    #bots-count {
      width: 80%;
    }

    @media screen and (max-width: 768px) {
      .modal-content {
        max-height: calc(90vh - 42px);
        max-width: 100vw;
        width: 100%;
      }
    }
  `;

  render() {
    return html`
      <div
        class="modal-overlay"
        style="display: ${this.isModalOpen ? "flex" : "none"}"
      >
        <div class="modal-content">
          <span class="close" @click=${this.close}>&times;</span>

          <div class="title">Single Player</div>

          <div class="options-layout">
            <!-- Map Selection -->
            <div class="options-section">
              <div class="option-title">Map</div>
              <div class="option-cards">
                ${Object.entries(GameMapType)
                  .filter(([key]) => isNaN(Number(key)))
                  .map(
                    ([key, value]) => html`
                      <div @click=${() => this.handleMapSelection(value)}>
                        <map-display
                          .mapKey=${key}
                          .selected=${this.selectedMap === value}
                        ></map-display>
                      </div>
                    `,
                  )}
              </div>
            </div>

            <!-- Difficulty Selection -->
            <div class="options-section">
              <div class="option-title">Difficulty</div>
              <div class="option-cards">
                ${Object.entries(Difficulty)
                  .filter(([key]) => isNaN(Number(key)))
                  .map(
                    ([key, value]) => html`
                      <div
                        class="option-card ${this.selectedDifficulty === value
                          ? "selected"
                          : ""}"
                        @click=${() => this.handleDifficultySelection(value)}
                      >
                        <difficulty-display
                          .difficultyKey=${key}
                        ></difficulty-display>
                        <p class="option-card-title">
                          ${DifficultyDescription[key]}
                        </p>
                      </div>
                    `,
                  )}
              </div>
            </div>

            <!-- Game Options -->
            <div class="options-section">
              <div class="option-title">Options</div>
              <div class="option-cards">
                <label for="bots-count" class="option-card">
                  <input
                    type="range"
                    id="bots-count"
                    min="0"
                    max="400"
                    step="1"
                    @input=${this.handleBotsChange}
                    @change=${this.handleBotsChange}
                    .value="${this.bots}"
                  />
                  <div class="option-card-title">
                    Bots: ${this.bots == 0 ? "Disabled" : this.bots}
                  </div>
                </label>

                <label
                  for="disable-npcs"
                  class="option-card ${this.disableNPCs ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="disable-npcs"
                    @change=${this.handleDisableNPCsChange}
                    .checked=${this.disableNPCs}
                  />
                  <div class="option-card-title">Disable Nations</div>
                </label>

                <label
                  for="instant-build"
                  class="option-card ${this.instantBuild ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="instant-build"
                    @change=${this.handleInstantBuildChange}
                    .checked=${this.instantBuild}
                  />
                  <div class="option-card-title">Instant build</div>
                </label>

                <label
                  for="infinite-gold"
                  class="option-card ${this.infiniteGold ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="infinite-gold"
                    @change=${this.handleInfiniteGoldChange}
                    .checked=${this.infiniteGold}
                  />
                  <div class="option-card-title">Infinite gold</div>
                </label>

                <label
                  for="infinite-troops"
                  class="option-card ${this.infiniteTroops ? "selected" : ""}"
                >
                  <div class="checkbox-icon"></div>
                  <input
                    type="checkbox"
                    id="infinite-troops"
                    @change=${this.handleInfiniteTroopsChange}
                    .checked=${this.infiniteTroops}
                  />
                  <div class="option-card-title">Infinite troops</div>
                </label>
              </div>
            </div>
          </div>

          <button @click=${this.startGame} class="start-game-button">
            Start Game
          </button>
        </div>
      </div>
    `;
  }

  public open() {
    this.isModalOpen = true;
  }

  public close() {
    this.isModalOpen = false;
  }
  private handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
  }
  private handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
  }
  private handleBotsChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.bots = value;
  }
  private handleInstantBuildChange(e: Event) {
    this.instantBuild = Boolean((e.target as HTMLInputElement).checked);
  }
  private handleInfiniteGoldChange(e: Event) {
    this.infiniteGold = Boolean((e.target as HTMLInputElement).checked);
  }
  private handleInfiniteTroopsChange(e: Event) {
    this.infiniteTroops = Boolean((e.target as HTMLInputElement).checked);
  }
  private handleDisableNPCsChange(e: Event) {
    this.disableNPCs = Boolean((e.target as HTMLInputElement).checked);
  }
  private startGame() {
    consolex.log(
      `Starting single player game with map: ${GameMapType[this.selectedMap]}`,
    );
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameType: GameType.Singleplayer,
          lobby: {
            id: generateID(),
          },
          map: this.selectedMap,
          difficulty: this.selectedDifficulty,
          disableNPCs: this.disableNPCs,
          bots: this.bots,
          infiniteGold: this.infiniteGold,
          infiniteTroops: this.infiniteTroops,
          instantBuild: this.instantBuild,
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }
}
