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
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: rgba(26, 26, 26, 0.95);
      border: 2px solid rgba(74, 103, 65, 0.6);
      padding: 25px;
      border-radius: 4px;
      z-index: 9999;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      color: #e8e8e8;
      width: 300px;
      text-align: center;
      transition:
        opacity 0.3s ease-in-out,
        visibility 0.3s ease-in-out;
    }

    .modal.visible {
      display: block;
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translate(-50%, -48%);
      }
      to {
        opacity: 1;
        transform: translate(-50%, -50%);
      }
    }

    .modal h2 {
      margin-bottom: 15px;
      font-size: 22px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #f0f0f0;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
    }

    .modal p {
      margin-bottom: 20px;
      background-color: rgba(74, 103, 65, 0.2);
      border: 1px solid rgba(74, 103, 65, 0.3);
      padding: 15px;
      border-radius: 4px;
      font-weight: 500;
    }

    .button-container {
      display: flex;
      justify-content: center;
      gap: 10px;
    }

    .modal button {
      padding: 12px 20px;
      font-size: 16px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      background: linear-gradient(135deg, #a64d4d, #8b4242);
      color: #f0f0f0;
      border: 2px solid rgba(166, 77, 77, 0.6);
      border-radius: 4px;
      transition:
        all 0.2s ease,
        transform 0.1s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    .modal button:hover {
      background: linear-gradient(135deg, #8b4242, #704040);
      border-color: rgba(166, 77, 77, 0.8);
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
    }

    .modal button:active {
      transform: translateY(1px);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }
  `;

  render() {
    return html`
      <div class="modal ${this.isVisible ? "visible" : ""}">
        <h2>${translateText("game_starting_modal.title")}</h2>
        <p>${translateText("game_starting_modal.desc")}</p>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }
}
