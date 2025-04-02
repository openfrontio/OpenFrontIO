import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserSettings } from "../core/game/UserSettings";
import "./components/baseComponents/setting/SettingNumber";
import "./components/baseComponents/setting/SettingSlider";
import "./components/baseComponents/setting/SettingToggle";

@customElement("user-setting")
export class UserSettingModal extends LitElement {
  private userSettings: UserSettings = new UserSettings();

  @state() private darkMode: boolean = this.userSettings.darkMode();

  @state() private keySequence: string[] = [];
  @state() private showEasterEggSettings = false;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
    isModalOpen: boolean;
  };

  createRenderRoot() {
    return this;
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
    document.body.style.overflow = "auto";
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (!this.modalEl?.isModalOpen || this.showEasterEggSettings) return;

    const key = e.key.toLowerCase();
    const nextSequence = [...this.keySequence, key].slice(-4);
    this.keySequence = nextSequence;

    if (nextSequence.join("") === "evan") {
      this.triggerEasterEgg();
      this.keySequence = [];
    }
  };

  private triggerEasterEgg() {
    console.log("🪺 Setting~ unlocked by EVAN combo!");
    this.showEasterEggSettings = true;
    const popup = document.createElement("div");
    popup.className = "easter-egg-popup";
    popup.textContent = "🎉 You found a secret setting!";
    document.body.appendChild(popup);

    setTimeout(() => {
      popup.remove();
    }, 5000);
  }

  toggleDarkMode(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;

    if (typeof enabled !== "boolean") {
      console.warn("Unexpected toggle event payload", e);
      return;
    }

    this.userSettings.set("settings.darkMode", enabled);

    if (enabled) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    console.log("🌙 Dark Mode:", enabled ? "ON" : "OFF");
  }

  private toggleEmojis(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.emojis", enabled);

    console.log("🤡 Emojis:", enabled ? "ON" : "OFF");
  }

  private toggleLeftClickOpensMenu(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.leftClickOpensMenu", enabled);
    console.log("🖱️ Left Click Opens Menu:", enabled ? "ON" : "OFF");

    this.requestUpdate();
  }

  private sliderAttackRatio(e: CustomEvent<{ value: number }>) {
    const value = e.detail?.value;
    if (typeof value === "number") {
      const ratio = value / 100;
      localStorage.setItem("settings.attackRatio", ratio.toString());
    } else {
      console.warn("Slider event missing detail.value", e);
    }
  }

  private sliderTroopRatio(e: CustomEvent<{ value: number }>) {
    const value = e.detail?.value;
    if (typeof value === "number") {
      const ratio = value / 100;
      localStorage.setItem("settings.troopRatio", ratio.toString());
    } else {
      console.warn("Slider event missing detail.value", e);
    }
  }

  render() {
    return html`
      <o-modal title="User Settings">
        <div class="modal-overlay">
          <div class="modal-content user-setting-modal">
            <div class="settings-list">
              <setting-toggle
                label="🌙 Dark Mode"
                description="Toggle the site’s appearance between light and dark themes"
                id="dark-mode-toggle"
                .checked=${this.userSettings.darkMode()}
                @change=${(e: CustomEvent<{ checked: boolean }>) =>
                  this.toggleDarkMode(e)}
              ></setting-toggle>

              <setting-toggle
                label="😊 Emojis"
                description="Toggle whether emojis are shown in game"
                id="emoji-toggle"
                .checked=${this.userSettings.emojis()}
                @change=${this.toggleEmojis}
              ></setting-toggle>

              <setting-toggle
                label="🖱️ Left Click to Open Menu"
                description="When ON, left-click opens menu and sword button attacks. When OFF, right-click attacks directly."
                id="left-click-toggle"
                .checked=${this.userSettings.leftClickOpensMenu()}
                @change=${this.toggleLeftClickOpensMenu}
              ></setting-toggle>

              <setting-slider
                label="⚔️ Attack Ratio"
                description="What percentage of your troops to send in an attack (1–100%)"
                min="1"
                max="100"
                .value=${Number(
                  localStorage.getItem("settings.attackRatio") ?? "0.2",
                ) * 100}
                @change=${this.sliderAttackRatio}
              ></setting-slider>

              <setting-slider
                label="🪖🛠️ Troops and Workers Ratio"
                description="Adjust the balance between troops (for combat) and workers (for gold production) (1–100%)"
                min="1"
                max="100"
                .value=${Number(
                  localStorage.getItem("settings.troopRatio") ?? "0.95",
                ) * 100}
                @change=${this.sliderTroopRatio}
              ></setting-slider>

              ${this.showEasterEggSettings
                ? html`
                    <setting-slider
                      label="Writing Speed Multiplier"
                      description="Adjust how fast you pretend to code (x1–x100)"
                      min="0"
                      max="100"
                      value="40"
                      easter="true"
                      @change=${(e: CustomEvent) => {
                        const value = e.detail?.value;
                        if (typeof value !== "undefined") {
                          console.log("Changed:", value);
                        } else {
                          console.warn("Slider event missing detail.value", e);
                        }
                      }}
                    ></setting-slider>

                    <setting-number
                      label="Bug Count"
                      description="How many bugs you're okay with (0–1000, emotionally)"
                      value="100"
                      min="0"
                      max="1000"
                      easter="true"
                      @change=${(e: CustomEvent) => {
                        const value = e.detail?.value;
                        if (typeof value !== "undefined") {
                          console.log("Changed:", value);
                        } else {
                          console.warn("Slider event missing detail.value", e);
                        }
                      }}
                    ></setting-number>
                  `
                : null}
            </div>
          </div>
        </div>
      </o-modal>
    `;
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }
}
