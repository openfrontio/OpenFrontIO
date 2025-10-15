import { html, LitElement } from "lit";
import { customElement, query } from "lit/decorators.js";
import { AccountModal } from "./AccountModal";
import "./components/Difficulties";
import "./components/PatternButton";
import { translateText } from "./Utils";

@customElement("login-cancelled-modal")
export class LoginCancelledModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  constructor() {
    super();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <o-modal
        id="login-cancelled-modal"
        title="${translateText("login_cancelled_modal.title") || "Login Cancelled"}"
      >
        <div class="p-6">
            <div class="mb-6">
              <h3 class="text-lg font-medium text-white mb-4 text-center">
                ${translateText("login_cancelled_modal.benefits_title") || "Logging in gives you access to more features"}:
              </h3>
              <ul class="list-disc ml-6">
                <li>${translateText("login_cancelled_modal.benefits_discord") || "Earn patterns based on your Discord role"}</li>
                <li>${translateText("login_cancelled_modal.benefits_patterns") || "Buy and use patterns"}</li>
                <li>${translateText("login_cancelled_modal.benefits_stats") || "Save and track your stats"}</li>
              </ul>
            </div>

            <!-- Divider -->
            <div class="relative mb-6">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-gray-300"></div>
              </div>
              <div class="relative flex justify-center text-sm">
                <span class="px-2 bg-gray-800 text-gray-300"></span>
              </div>
            </div>
            
          <!-- Bottom buttons -->
          <div class="flex justify-center space-x-3">
            <button
              @click="${this.close}"
              class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              ${translateText("login_cancelled_modal.button_cancel") || "Cancel"}
            </button>
            <button
              @click="${this.tryAgain}"
              class="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              ${translateText("login_cancelled_modal.button_try_again") || "Try again"}
            </button>
        </div>
      </o-modal>
    `;
  }

  public async open() {
    this.modalEl?.open();
    this.requestUpdate();
  }

  public close() {
    this.modalEl?.close();
  }

  private tryAgain() {
    const accountModal = document.querySelector(
      "account-modal",
    ) as AccountModal;

    this.close();
    if (accountModal) {
      accountModal.open();
    }
  }
}
