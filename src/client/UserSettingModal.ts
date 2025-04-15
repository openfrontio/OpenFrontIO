import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { UserSettings } from "../core/game/UserSettings";
import "./components/baseComponents/setting/SettingKeybind";
import "./components/baseComponents/setting/SettingNumber";
import "./components/baseComponents/setting/SettingSlider";
import "./components/baseComponents/setting/SettingToggle";

@customElement("user-setting")
export class UserSettingModal extends LitElement {
  private userSettings: UserSettings = new UserSettings();

  @state() private settingsMode: "basic" | "keybinds" = "basic";
  @state() private keybinds: Record<string, string> = {};

  @state() private keySequence: string[] = [];
  @state() private showEasterEggSettings = false;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);

    const savedKeybinds = localStorage.getItem("settings.keybinds");
    if (savedKeybinds) {
      try {
        this.keybinds = JSON.parse(savedKeybinds);
      } catch (e) {
        console.warn("Invalid keybinds JSON:", e);
      }
    }
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

  private handleKeybindChange(
    e: CustomEvent<{ action: string; value: string }>,
  ) {
    const { action, value } = e.detail;

    this.keybinds = { ...this.keybinds, [action]: value };
    localStorage.setItem("settings.keybinds", JSON.stringify(this.keybinds));
  }

  render() {
    return html`
      <o-modal title="${translateText("user_setting.title")}">
        <div class="modal-overlay">
          <div class="modal-content user-setting-modal">
            <div class="flex mb-4 w-full justify-center">
              <button
                class="w-1/2 text-center px-3 py-1 rounded-l 
      ${this.settingsMode === "basic"
                  ? "bg-white/10 text-white"
                  : "bg-transparent text-gray-400"}"
                @click=${() => (this.settingsMode = "basic")}
              >
                ${translateText("user_setting.tab_basic")}
              </button>
              <button
                class="w-1/2 text-center px-3 py-1 rounded-r 
      ${this.settingsMode === "keybinds"
                  ? "bg-white/10 text-white"
                  : "bg-transparent text-gray-400"}"
                @click=${() => (this.settingsMode = "keybinds")}
              >
                ${translateText("user_setting.tab_keybinds")}
              </button>
            </div>

            <div class="settings-list">
              ${this.settingsMode === "basic"
                ? html`
                    <!-- 🌙 Dark Mode -->
                    <setting-toggle
                      label="${translateText("user_setting.dark_mode_label")}"
                      description="${translateText(
                        "user_setting.dark_mode_desc",
                      )}"
                      id="dark-mode-toggle"
                      .checked=${this.userSettings.darkMode()}
                      @change=${(e: CustomEvent<{ checked: boolean }>) =>
                        this.toggleDarkMode(e)}
                    ></setting-toggle>

                    <!-- 😊 Emojis -->
                    <setting-toggle
                      label="${translateText("user_setting.emojis_label")}"
                      description="${translateText("user_setting.emojis_desc")}"
                      id="emoji-toggle"
                      .checked=${this.userSettings.emojis()}
                      @change=${this.toggleEmojis}
                    ></setting-toggle>

                    <!-- 🖱️ Left Click Menu -->
                    <setting-toggle
                      label="${translateText("user_setting.left_click_label")}"
                      description="${translateText(
                        "user_setting.left_click_desc",
                      )}"
                      id="left-click-toggle"
                      .checked=${this.userSettings.leftClickOpensMenu()}
                      @change=${this.toggleLeftClickOpensMenu}
                    ></setting-toggle>

                    <!-- ⚔️ Attack Ratio -->
                    <setting-slider
                      label="${translateText(
                        "user_setting.attack_ratio_label",
                      )}"
                      description="${translateText(
                        "user_setting.attack_ratio_desc",
                      )}"
                      min="1"
                      max="100"
                      .value=${Number(
                        localStorage.getItem("settings.attackRatio") ?? "0.2",
                      ) * 100}
                      @change=${this.sliderAttackRatio}
                    ></setting-slider>

                    <!-- 🪖🛠️ Troop Ratio -->
                    <setting-slider
                      label="${translateText("user_setting.troop_ratio_label")}"
                      description="${translateText(
                        "user_setting.troop_ratio_desc",
                      )}"
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
                            label="${translateText(
                              "user_setting.easter_writing_speed_label",
                            )}"
                            description="${translateText(
                              "user_setting.easter_writing_speed_desc",
                            )}"
                            min="0"
                            max="100"
                            value="40"
                            easter="true"
                            @change=${(e: CustomEvent) => {
                              const value = e.detail?.value;
                              if (typeof value !== "undefined") {
                                console.log("Changed:", value);
                              } else {
                                console.warn(
                                  "Slider event missing detail.value",
                                  e,
                                );
                              }
                            }}
                          ></setting-slider>

                          <setting-number
                            label="${translateText(
                              "user_setting.easter_bug_count_label",
                            )}"
                            description="${translateText(
                              "user_setting.easter_bug_count_desc",
                            )}"
                            value="100"
                            min="0"
                            max="1000"
                            easter="true"
                            @change=${(e: CustomEvent) => {
                              const value = e.detail?.value;
                              if (typeof value !== "undefined") {
                                console.log("Changed:", value);
                              } else {
                                console.warn(
                                  "Slider event missing detail.value",
                                  e,
                                );
                              }
                            }}
                          ></setting-number>
                        `
                      : null}
                  `
                : html`
                    <div
                      class="text-center text-white text-base font-semibold mt-5 mb-2"
                    >
                      Zoom Controls
                    </div>

                    <setting-keybind
                      action="zoomOut"
                      label="Zoom Out"
                      description="Zoom out the map"
                      defaultKey="KeyQ"
                      .value=${this.keybinds["zoomOut"] ?? ""}
                      @change=${this.handleKeybindChange}
                    ></setting-keybind>

                    <setting-keybind
                      action="zoomIn"
                      label="Zoom In"
                      description="Zoom in the map"
                      defaultKey="KeyE"
                      .value=${this.keybinds["zoomIn"] ?? ""}
                      @change=${this.handleKeybindChange}
                    ></setting-keybind>

                    <div
                      class="text-center text-white text-base font-semibold mt-5 mb-2"
                    >
                      Camera Movement
                    </div>

                    <setting-keybind
                      action="moveUp"
                      label="Move Camera Up"
                      description="Move the camera upward"
                      defaultKey="KeyW"
                      .value=${this.keybinds["moveUp"] ?? ""}
                      @change=${this.handleKeybindChange}
                    ></setting-keybind>

                    <setting-keybind
                      action="moveLeft"
                      label="Move Camera Left"
                      description="Move the camera to the left"
                      defaultKey="KeyA"
                      .value=${this.keybinds["moveLeft"] ?? ""}
                      @change=${this.handleKeybindChange}
                    ></setting-keybind>

                    <setting-keybind
                      action="moveDown"
                      label="Move Camera Down"
                      description="Move the camera downward"
                      defaultKey="KeyS"
                      .value=${this.keybinds["moveDown"] ?? ""}
                      @change=${this.handleKeybindChange}
                    ></setting-keybind>

                    <setting-keybind
                      action="moveRight"
                      label="Move Camera Right"
                      description="Move the camera to the right"
                      defaultKey="KeyD"
                      .value=${this.keybinds["moveRight"] ?? ""}
                      @change=${this.handleKeybindChange}
                    ></setting-keybind>
                  `}
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
