import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "./Utils";

@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  static styles = css`
    .modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: #1a1a1a; /* Dark, military gray */
      z-index: 9999;
      color: #fff;
      text-align: center;
      overflow: hidden;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.5s ease-in-out, visibility 0.5s ease-in-out;
    }

    .modal.visible {
      opacity: 1;
      visibility: visible;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
    }

    .rectangle-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: #8b0000; /* Deep red, fully opaque */
      background-image: repeating-linear-gradient(
        45deg,
        #000 0,
        #000 10px,
        transparent 10px,
        transparent 20px
      ); /* Diagonal black caution stripes */
      transform: translateY(-100%);
      animation: slideInOut 5s ease-in-out forwards;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 1;
      box-shadow: inset 0 0 50px rgba(0, 0, 0, 0.7); /* Gritty military shadow */
    }

    @keyframes slideInOut {
      0% {
        transform: translateY(-100%);
        opacity: 0;
      }
      15% {
        transform: translateY(0);
        opacity: 1;
      }
      85% {
        transform: translateY(0);
        opacity: 1;
      }
      100% {
        transform: translateY(100%);
        opacity: 0;
      }
    }

    .rectangle-overlay h2 {
      font-family: "Bebas Neue", "Impact", sans-serif; /* Bold, Cold War font */
      font-size: 48px;
      margin-bottom: 15px;
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 3px;
      text-shadow: 3px 3px 5px rgba(0, 0, 0, 0.8); /* Harsh shadow */
      font-weight: 700;
    }

    .rectangle-overlay p {
      font-family: "Courier New", monospace; /* Military typewriter */
      font-size: 24px;
      color: #d3d3d3; /* Off-white for contrast */
      background-color: rgba(0, 0, 0, 0.6); /* Dark backing for readability */
      padding: 10px 20px;
      border-radius: 5px;
      border: 2px solid #444; /* Rough military border */
      text-transform: uppercase;
      letter-spacing: 1px;
    }
  `;

  render() {
    return html`
      <div class="modal ${this.isVisible ? "visible" : ""}">
        <div class="rectangle-overlay">
          <h2>${translateText("game_starting_modal.title")}</h2>
          <p>${translateText("game_starting_modal.desc")}</p>
        </div>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
    // Ensure modal stays visible for 5 seconds
    setTimeout(() => {
      this.hide();
    }, 5000);
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }
}
