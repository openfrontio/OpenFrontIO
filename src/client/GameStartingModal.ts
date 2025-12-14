import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "./Utils";

@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  static styles = css`
    .overlay {
      display: none;
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(4px);
      z-index: 9998;
    }

    .overlay.visible {
      display: block;
    }

    .modal {
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: rgba(30, 30, 30, 0.7);
      padding: 25px;
      border-radius: 10px;
      z-index: 9999;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(5px);
      color: white;
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
      color: white;
    }

    .modal p {
      margin: 2px 0;
      font-size: 14px;
    }

    .modal .loading {
      font-size: 16px;
      margin-top: 20px;
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

    .copyright {
      font-size: 20px;
      margin-top: 20px;
      margin-bottom: 10px;
      opacity: 1;
    }

    .modal a {
      display: block;
      margin-top: 10px;
      margin-bottom: 15px;
      font-size: 20px;
      color: #4a9eff;
      text-decoration: none;
      transition: color 0.2s ease;
    }

    .modal a:hover {
      color: #6bb0ff;
      text-decoration: underline;
    }
  `;

  render() {
    return html`
      <div class="overlay ${this.isVisible ? "visible" : ""}"></div>
      <div class="modal ${this.isVisible ? "visible" : ""}">
        <div class="copyright">© OpenFront and Contributors</div>
        <a
          href="https://github.com/openfrontio/OpenFrontIO/blob/main/CREDITS.md"
          target="_blank"
          rel="noopener noreferrer"
          >${translateText("game_starting_modal.credits")}</a
        >
        <p>${translateText("game_starting_modal.code_license")}</p>
        <p class="loading">${translateText("game_starting_modal.title")}</p>
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
