import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "./Utils";

@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  static styles = css`
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(30, 30, 30, 0.7);
      z-index: 9999;
      color: white;
      text-align: center;
      transition: opacity 0.3s ease-in-out;
      overflow: hidden;
    }

    .modal.visible {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      opacity: 1;
    }

    .modal-content {
      background-color: rgba(30, 30, 30, 0.7);
      padding: 25px;
      border-radius: 10px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(5px);
      width: 300px;
      position: relative;
      z-index: 2;
    }

    .rectangle-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(255, 100, 100, 0.9);
      transform: translateY(-100%);
      animation: slideInOut 5s ease-in-out forwards;
      z-index: 1;
    }

    @keyframes slideInOut {
      0% {
        transform: translateY(-100%);
      }
      10% {
        transform: translateY(0);
      }
      90% {
        transform: translateY(0);
      }
      100% {
        transform: translateY(100%);
      }
    }

    .modal h2 {
      margin-bottom: 15px;
      font-size: 22px;
      color: white;
    }

    .modal p {
      margin-bottom: 20px;
      background-color: rgba(0, 0, 0, 0.3);
      padding: 10px;
      border-radius: 5px;
    }

    .button-container {
      display: flex;
      justify-content: center;
      gap: 10px;
    }

    .modal button {
      padding: 12px;
      font-size: 16px;
      cursor: pointer;
      background: rgba(255, 100, 100, 0.7);
      color: white;
      border: none;
      border-radius: 5px;
      transition:
        background-color 0.2s ease,
        transform 0.1s ease;
    }

    .modal button:hover {
      background: rgba(255, 100, 100, 0.9);
      transform: translateY(-1px);
    }

    .modal button:active {
      transform: translateY(1px);
    }
  `;

  render() {
    return html`
      <div class="modal ${this.isVisible ? "visible" : ""}">
        <div class="rectangle-overlay"></div>
        <div class="modal-content">
          <h2>${translateText("game_starting_modal.title")}</h2>
          <p>${translateText("game_starting_modal.desc")}</p>
        </div>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
    
    setTimeout(() => {
      this.hide();
    }, 5000);
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }
}
