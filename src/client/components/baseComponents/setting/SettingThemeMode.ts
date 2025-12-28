import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ThemeMode } from "../../../../core/game/UserSettings";

@customElement("setting-theme-mode")
export class SettingThemeMode extends LitElement {
  @property() label = "Theme";
  @property() description = "";

  @state() private selectedMode: ThemeMode = "system";

  static styles = css`
    :host {
      display: block;
    }

    .setting-theme {
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--modal-card-bg, #1e1e1e);
      border: 1px solid var(--modal-card-border, #333);
      border-radius: 10px;
      padding: 12px 20px;
      box-shadow: var(--setting-item-shadow, 0 2px 6px rgba(0, 0, 0, 0.4));
    }

    .setting-header {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .setting-label {
      color: var(--modal-text, #f0f0f0);
      font-size: 15px;
      font-weight: 500;
    }

    .setting-description {
      font-size: 12px;
      color: var(--modal-text-muted, #888);
    }

    .theme-options {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }

    .theme-option {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 12px 8px;
      border: 2px solid var(--modal-card-border, #333);
      border-radius: 8px;
      background: var(--modal-hover, #2a2a2a);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .theme-option:hover {
      background: var(--setting-item-hover, #3a3a3a);
      border-color: var(--modal-border, #555);
    }

    .theme-option.selected {
      border-color: #4caf50;
      background: rgba(76, 175, 80, 0.1);
    }

    .theme-icon {
      font-size: 24px;
    }

    .theme-label {
      font-size: 12px;
      color: var(--modal-text-muted, #ccc);
      text-transform: capitalize;
    }

    .theme-option.selected .theme-label {
      color: #4caf50;
      font-weight: 500;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.loadThemeMode();
    window.addEventListener("dark-mode-changed", this.handleExternalChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("dark-mode-changed", this.handleExternalChange);
  }

  private loadThemeMode() {
    const stored = localStorage.getItem("settings.themeMode");
    if (stored === "light" || stored === "dark" || stored === "system") {
      this.selectedMode = stored;
    } else {
      // Check legacy darkMode
      const darkMode = localStorage.getItem("settings.darkMode");
      this.selectedMode = darkMode === "true" ? "dark" : "system";
    }
  }

  private handleExternalChange = () => {
    this.loadThemeMode();
  };

  private selectMode(mode: ThemeMode) {
    this.selectedMode = mode;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { mode },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="setting-theme">
        <div class="setting-header">
          <span class="setting-label">${this.label}</span>
          <span class="setting-description">${this.description}</span>
        </div>
        <div class="theme-options">
          <div
            class="theme-option ${this.selectedMode === "light"
              ? "selected"
              : ""}"
            @click=${() => this.selectMode("light")}
          >
            <span class="theme-icon">☀️</span>
            <span class="theme-label">Light</span>
          </div>
          <div
            class="theme-option ${this.selectedMode === "dark"
              ? "selected"
              : ""}"
            @click=${() => this.selectMode("dark")}
          >
            <span class="theme-icon">🌙</span>
            <span class="theme-label">Dark</span>
          </div>
          <div
            class="theme-option ${this.selectedMode === "system"
              ? "selected"
              : ""}"
            @click=${() => this.selectMode("system")}
          >
            <span class="theme-icon">💻</span>
            <span class="theme-label">System</span>
          </div>
        </div>
      </div>
    `;
  }
}
