import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { UserSettings } from "../core/game/UserSettings";
import "./components/baseComponents/setting/SettingKeybind";
import { SettingKeybind } from "./components/baseComponents/setting/SettingKeybind";
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

  private toggleFxLayer(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.specialEffects", enabled);

    console.log("💥 Special effects:", enabled ? "ON" : "OFF");
  }

  private toggleAnonymousNames(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.anonymousNames", enabled);

    console.log("🙈 Anonymous Names:", enabled ? "ON" : "OFF");
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

  private toggleTerritoryPatterns(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.territoryPatterns", enabled);

    console.log("🏳️ Territory Patterns:", enabled ? "ON" : "OFF");
  }

  private handleKeybindChange(
    e: CustomEvent<{ action: string; value: string }>,
  ) {
    const { action, value } = e.detail;
    const prevValue = this.keybinds[action] ?? "";

    const values = Object.entries(this.keybinds)
      .filter(([k]) => k !== action)
      .map(([, v]) => v);
    if (values.includes(value) && value !== "Null") {
      const popup = document.createElement("div");
      popup.className = "setting-popup";
      popup.textContent = `The key "${value}" is already assigned to another action.`;
      document.body.appendChild(popup);
      const element = this.renderRoot.querySelector(
        `setting-keybind[action="${action}"]`,
      ) as SettingKeybind;
      if (element) {
        element.value = prevValue;
        element.requestUpdate();
      }
      return;
    }
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
                ? this.renderBasicSettings()
                : this.renderKeybindSettings()}
            </div>
          </div>
        </div>
      </o-modal>
    `;
  }

  private renderBasicSettings() {
    return html`
      <!-- 🌙 Dark Mode -->
      <setting-toggle
        label="${translateText("user_setting.dark_mode_label")}"
        description="${translateText("user_setting.dark_mode_desc")}"
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

      <!-- 💥 Special effects -->
      <setting-toggle
        label="${translateText("user_setting.special_effects_label")}"
        description="${translateText("user_setting.special_effects_desc")}"
        id="special-effect-toggle"
        .checked=${this.userSettings.fxLayer()}
        @change=${this.toggleFxLayer}
      ></setting-toggle>

      <!-- 🖱️ Left Click Menu -->
      <setting-toggle
        label="${translateText("user_setting.left_click_label")}"
        description="${translateText("user_setting.left_click_desc")}"
        id="left-click-toggle"
        .checked=${this.userSettings.leftClickOpensMenu()}
        @change=${this.toggleLeftClickOpensMenu}
      ></setting-toggle>

      <!-- 🙈 Anonymous Names -->
      <setting-toggle
        label="${translateText("user_setting.anonymous_names_label")}"
        description="${translateText("user_setting.anonymous_names_desc")}"
        id="anonymous-names-toggle"
        .checked=${this.userSettings.anonymousNames()}
        @change=${this.toggleAnonymousNames}
      ></setting-toggle>

      <!-- 🏳️ Territory Patterns -->
      <setting-toggle
        label="${translateText("user_setting.territory_patterns_label")}"
        description="${translateText("user_setting.territory_patterns_desc")}"
        id="territory-patterns-toggle"
        .checked=${this.userSettings.territoryPatterns()}
        @change=${this.toggleTerritoryPatterns}
      ></setting-toggle>

      <!-- ⚔️ Attack Ratio -->
      <setting-slider
        label="${translateText("user_setting.attack_ratio_label")}"
        description="${translateText("user_setting.attack_ratio_desc")}"
        min="1"
        max="100"
        .value=${Number(localStorage.getItem("settings.attackRatio") ?? "0.2") *
        100}
        @change=${this.sliderAttackRatio}
      ></setting-slider>

      <!-- 🪖🛠️ Troop Ratio -->
      <setting-slider
        label="${translateText("user_setting.troop_ratio_label")}"
        description="${translateText("user_setting.troop_ratio_desc")}"
        min="1"
        max="100"
        .value=${Number(localStorage.getItem("settings.troopRatio") ?? "0.95") *
        100}
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
                if (value !== undefined) {
                  console.log("Changed:", value);
                } else {
                  console.warn("Slider event missing detail.value", e);
                }
              }}
            ></setting-slider>

            <setting-number
              label="${translateText("user_setting.easter_bug_count_label")}"
              description="${translateText(
                "user_setting.easter_bug_count_desc",
              )}"
              value="100"
              min="0"
              max="1000"
              easter="true"
              @change=${(e: CustomEvent) => {
                const value = e.detail?.value;
                if (value !== undefined) {
                  console.log("Changed:", value);
                } else {
                  console.warn("Slider event missing detail.value", e);
                }
              }}
            ></setting-number>
          `
        : null}
    `;
  }

  private renderKeybindSettings() {
    return html`
      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.view_options")}
      </div>

      <setting-keybind
        action="toggleView"
        label=${translateText("user_setting.toggle_view")}
        description=${translateText("user_setting.toggle_view_desc")}
        defaultKey="Space"
        .value=${this.keybinds["toggleView"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.attack_ratio_controls")}
      </div>

      <setting-keybind
        action="attackRatioDown"
        label=${translateText("user_setting.attack_ratio_down")}
        description=${translateText("user_setting.attack_ratio_down_desc")}
        defaultKey="Digit1"
        .value=${this.keybinds["attackRatioDown"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="attackRatioUp"
        label=${translateText("user_setting.attack_ratio_up")}
        description=${translateText("user_setting.attack_ratio_up_desc")}
        defaultKey="Digit2"
        .value=${this.keybinds["attackRatioUp"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.attack_keybinds")}
      </div>

      <setting-keybind
        action="boatAttack"
        label=${translateText("user_setting.boat_attack")}
        description=${translateText("user_setting.boat_attack_desc")}
        defaultKey="KeyB"
        .value=${this.keybinds["boatAttack"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.zoom_controls")}
      </div>

      <setting-keybind
        action="zoomOut"
        label=${translateText("user_setting.zoom_out")}
        description=${translateText("user_setting.zoom_out_desc")}
        defaultKey="KeyQ"
        .value=${this.keybinds["zoomOut"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="zoomIn"
        label=${translateText("user_setting.zoom_in")}
        description=${translateText("user_setting.zoom_in_desc")}
        defaultKey="KeyE"
        .value=${this.keybinds["zoomIn"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <div class="text-center text-white text-base font-semibold mt-5 mb-2">
        ${translateText("user_setting.camera_movement")}
      </div>

      <setting-keybind
        action="centerCamera"
        label=${translateText("user_setting.center_camera")}
        description=${translateText("user_setting.center_camera_desc")}
        defaultKey="KeyC"
        .value=${this.keybinds["centerCamera"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveUp"
        label=${translateText("user_setting.move_up")}
        description=${translateText("user_setting.move_up_desc")}
        defaultKey="KeyW"
        .value=${this.keybinds["moveUp"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveLeft"
        label=${translateText("user_setting.move_left")}
        description=${translateText("user_setting.move_left_desc")}
        defaultKey="KeyA"
        .value=${this.keybinds["moveLeft"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveDown"
        label=${translateText("user_setting.move_down")}
        description=${translateText("user_setting.move_down_desc")}
        defaultKey="KeyS"
        .value=${this.keybinds["moveDown"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveRight"
        label=${translateText("user_setting.move_right")}
        description=${translateText("user_setting.move_right_desc")}
        defaultKey="KeyD"
        .value=${this.keybinds["moveRight"] ?? ""}
        @change=${this.handleKeybindChange}
      ></setting-keybind>
    `;
  }

  public open() {
    this.requestUpdate();
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }
}
