import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { getServerConfigFromClient } from "../../core/configuration/ConfigLoader";
import { UserSettings } from "../../core/game/UserSettings";
import { copyToClipboard, translateText } from "../Utils";

@customElement("copy-button")
export class CopyButton extends LitElement {
  @property({ type: String, attribute: "lobby-id" }) lobbyId = "";
  @property({ type: String, attribute: "lobby-suffix" }) lobbySuffix = "";
  @property({ type: Boolean, attribute: "include-lobby-query" })
  includeLobbyQuery = false;
  @property({ type: String, attribute: "copy-text" }) copyText = "";
  @property({ type: String, attribute: "display-text" }) displayText = "";
  @property({ type: Boolean, attribute: "show-visibility-toggle" })
  showVisibilityToggle = true;
  @property({ type: Boolean, attribute: "show-copy-icon" })
  showCopyIcon = true;
  @property({ type: Boolean }) compact = false;

  @state() private copySuccess = false;
  @state() private lobbyIdVisible = true;

  private userSettings: UserSettings = new UserSettings();
  private maskLabel = html`&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;`;

  createRenderRoot() {
    return this;
  }

  protected willUpdate(
    changedProperties: Map<string | number | symbol, unknown>,
  ) {
    if (changedProperties.has("lobbyId")) {
      this.lobbyIdVisible = this.userSettings.get(
        "settings.lobbyIdVisibility",
        true,
      );
      this.copySuccess = false;
    }
    if (changedProperties.has("copyText")) {
      this.copySuccess = false;
    }
    if (
      changedProperties.has("showVisibilityToggle") ||
      changedProperties.has("compact")
    ) {
      if (!this.showVisibilityToggle || this.compact) {
        this.lobbyIdVisible = true;
      }
    }
  }

  private toggleVisibility() {
    if (!this.showVisibilityToggle || this.compact) return;
    this.lobbyIdVisible = !this.lobbyIdVisible;
  }

  private enableSelectAll(e: Event) {
    (e.currentTarget as HTMLElement).classList.add("select-all");
  }

  private clearSelectAll(e: Event) {
    (e.currentTarget as HTMLElement).classList.remove("select-all");
  }

  private async buildCopyUrl(): Promise<string> {
    const config = await getServerConfigFromClient();
    let url = `${window.location.origin}/${config.workerPath(this.lobbyId)}/game/${this.lobbyId}`;
    if (this.includeLobbyQuery) {
      url += `?lobby&s=${encodeURIComponent(this.lobbySuffix)}`;
    }
    return url;
  }

  private async resolveCopyText(): Promise<string> {
    if (this.copyText) return this.copyText;
    if (!this.lobbyId) return "";
    return await this.buildCopyUrl();
  }

  private async handleCopy() {
    const text = await this.resolveCopyText();
    if (!text) return;
    await copyToClipboard(
      text,
      () => (this.copySuccess = true),
      () => (this.copySuccess = false),
    );
  }

  private canCopy() {
    return Boolean(this.copyText || this.lobbyId);
  }

  render() {
    const canCopy = this.canCopy();
    const allowMask = this.showVisibilityToggle && !this.compact;
    const rawLabel = this.displayText || this.lobbyId || this.copyText;
    const label = this.copySuccess
      ? translateText("common.copied")
      : allowMask && !this.lobbyIdVisible
        ? this.maskLabel
        : rawLabel;
    const disabledClass = canCopy ? "" : "opacity-60 cursor-not-allowed";
    const toggleDisabled = !this.lobbyId;
    const toggleClass = toggleDisabled ? "opacity-60 cursor-not-allowed" : "";

    if (this.compact) {
      return html`
        <button
          @click=${this.handleCopy}
          class="text-xs text-white/60 font-mono bg-white/5 px-2 py-0.5 rounded border border-white/5 hover:bg-white/10 hover:text-white transition-colors ${disabledClass}"
          title="${translateText("common.click_to_copy")}"
          aria-label="${translateText("common.click_to_copy")}"
          ?disabled=${!canCopy}
          type="button"
        >
          ${label}
        </button>
      `;
    }

    return html`
      <div
        class="flex items-center gap-0.5 bg-white/5 rounded-lg px-2 py-1 border border-white/10 max-w-[220px] flex-nowrap"
      >
        ${this.showVisibilityToggle
          ? html`<button
              @click=${this.toggleVisibility}
              class="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors ${toggleClass}"
              title="${translateText("user_setting.toggle_visibility")}"
              ?disabled=${toggleDisabled}
              type="button"
            >
              ${this.lobbyIdVisible
                ? html`<svg
                    viewBox="0 0 512 512"
                    height="16px"
                    width="16px"
                    fill="currentColor"
                  >
                    <path
                      d="M256 105c-101.8 0-188.4 62.7-224 151 35.6 88.3 122.2 151 224 151s188.4-62.7 224-151c-35.6-88.3-122.2-151-224-151zm0 251.7c-56 0-101.7-45.7-101.7-101.7S200 153.3 256 153.3 357.7 199 357.7 255 312 356.7 256 356.7zm0-161.1c-33 0-59.4 26.4-59.4 59.4s26.4 59.4 59.4 59.4 59.4-26.4 59.4-59.4-26.4-59.4-59.4-59.4z"
                    ></path>
                  </svg>`
                : html`<svg
                    viewBox="0 0 512 512"
                    height="16px"
                    width="16px"
                    fill="currentColor"
                  >
                    <path
                      d="M448 256s-64-128-192-128S64 256 64 256c32 64 96 128 192 128s160-64 192-128z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="32"
                    ></path>
                    <path
                      d="M144 256l224 0"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="32"
                      stroke-linecap="round"
                    ></path>
                  </svg>`}
            </button>`
          : ""}
        <button
          @click=${this.handleCopy}
          @dblclick=${this.enableSelectAll}
          @mouseleave=${this.clearSelectAll}
          class="font-mono text-xs font-bold text-white px-2 cursor-pointer select-none min-w-[80px] text-center truncate tracking-wider bg-transparent border-0 ${disabledClass}"
          title="${translateText("common.click_to_copy")}"
          aria-label="${translateText("common.click_to_copy")}"
          ?disabled=${!canCopy}
          type="button"
        >
          ${label}
        </button>
        ${this.showCopyIcon
          ? html`<button
              @click=${this.handleCopy}
              class="p-1.5 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition-colors ${disabledClass}"
              title="${translateText("common.click_to_copy")}"
              aria-label="${translateText("common.click_to_copy")}"
              ?disabled=${!canCopy}
              type="button"
            >
              <svg
                viewBox="0 0 24 24"
                height="16px"
                width="16px"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
                />
              </svg>
            </button>`
          : ""}
      </div>
    `;
  }
}
