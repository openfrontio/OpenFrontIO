import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserSettings } from "../../../core/game/UserSettings";
import { translateText } from "../../Utils";
import "../baseComponents/setting/SettingKeybind";
import { SettingKeybind } from "../baseComponents/setting/SettingKeybind";
import "../baseComponents/setting/SettingNumber";
import "../baseComponents/setting/SettingSlider";
import "../baseComponents/setting/SettingToggle";

@customElement("user-setting")
export class UserSettingModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
    isModalOpen: boolean;
  };
  private userSettings: UserSettings = new UserSettings();

  @state() private settingsMode: "basic" | "keybinds" = "basic";
  @state() private keybinds: Record<string, string> = {};
  @state() private keySequence: string[] = [];

  createRenderRoot() {
    return this;
  }

  public open() {
    this.requestUpdate();
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

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

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
    document.body.style.overflow = "auto";
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (!this.modalEl?.isModalOpen) return;

    const key = e.key.toLowerCase();
    const nextSequence = [...this.keySequence, key].slice(-4);
    this.keySequence = nextSequence;

    if (nextSequence.join("") === "evan") {
      this.keySequence = [];
    }
  };

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

  private handleKeybindChange(
    e: CustomEvent<{ action: string; value: string }>,
  ) {
    const { action, value } = e.detail;

    if (!action || !value) {
      console.warn("Invalid keybind change event:", e);
      return;
    }

    const prevValue = this.keybinds[action] ?? "";
    const values = Object.entries(this.keybinds)
      .filter(([key]: [string, string]) => key !== action)
      .map(([, val]: [string, string]) => val);

    if (value !== "Null" && values.includes(value)) {
      const popup = document.createElement("div");
      popup.className =
        "fixed top-10 left-1/2 -translate-x-1/2 -translate-y-1/2 scale-90 px-6 py-4 bg-backgroundDark text-textLight font-title text-large z-[1000]";
      popup.textContent = `The key "${value}" is already assigned to another action.`;
      document.body.appendChild(popup);

      const element = this.querySelector(
        `setting-keybind[action="${action}"]`,
      ) as SettingKeybind;
      if (element) {
        element.value = prevValue;
        element.requestUpdate();
      }

      setTimeout(() => {
        popup.remove();
      }, 3000);
      return;
    }

    this.keybinds = { ...this.keybinds, [action]: value };
    localStorage.setItem("settings.keybinds", JSON.stringify(this.keybinds));
    this.requestUpdate();
  }

  private renderBasicSettings() {
    return html`
      <!-- 🌙 Dark Mode -->
      <setting-toggle
        label="${translateText("user_setting.dark_mode_label")}"
        description="${translateText("user_setting.dark_mode_desc")}"
        id="dark-mode-toggle"
        icon="icons/moon.svg"
        .checked=${this.userSettings.darkMode()}
        @change=${(e: CustomEvent<{ checked: boolean }>) =>
          this.toggleDarkMode(e)}
      ></setting-toggle>

      <!-- 😊 Emojis -->
      <setting-toggle
        label="${translateText("user_setting.emojis_label")}"
        description="${translateText("user_setting.emojis_desc")}"
        id="emoji-toggle"
        icon="icons/smile.svg"
        .checked=${this.userSettings.emojis()}
        @change=${this.toggleEmojis}
      ></setting-toggle>

      <!-- 💥 Special effects -->
      <setting-toggle
        label="${translateText("user_setting.special_effects_label")}"
        description="${translateText("user_setting.special_effects_desc")}"
        id="special-effect-toggle"
        icon="icons/sparkles.svg"
        .checked=${this.userSettings.fxLayer()}
        @change=${this.toggleFxLayer}
      ></setting-toggle>

      <!-- 🖱️ Left Click Menu -->
      <setting-toggle
        label="${translateText("user_setting.left_click_label")}"
        description="${translateText("user_setting.left_click_desc")}"
        id="left-click-toggle"
        icon="icons/mouse-pointer.svg"
        .checked=${this.userSettings.leftClickOpensMenu()}
        @change=${this.toggleLeftClickOpensMenu}
      ></setting-toggle>

      <!-- 🙈 Anonymous Names -->
      <setting-toggle
        label="${translateText("user_setting.anonymous_names_label")}"
        description="${translateText("user_setting.anonymous_names_desc")}"
        id="anonymous-names-toggle"
        icon="icons/eye-off.svg"
        .checked=${this.userSettings.anonymousNames()}
        @change=${this.toggleAnonymousNames}
      ></setting-toggle>

      <!-- ⚔️ Attack Ratio -->
      <setting-slider
        label="${translateText("user_setting.attack_ratio_label")}"
        description="${translateText("user_setting.attack_ratio_desc")}"
        min="1"
        max="100"
        .value=${Number(localStorage.getItem("settings.attackRatio") ?? "0.2") *
        100}
        icon="icons/swords.svg"
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
        icon="icons/users.svg"
        @change=${this.sliderTroopRatio}
      ></setting-slider>
    `;
  }

  private renderKeybindSettings() {
    return html`
      <div
        class=" text-center text-textLight text-base font-semibold   bg-backgroundDarkLighter py-2"
      >
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

      <div
        class=" text-center text-textLight text-base font-semibold mt-5  bg-backgroundDarkLighter py-2"
      >
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

      <div
        class=" text-center text-textLight text-base font-semibold mt-5  bg-backgroundDarkLighter py-2"
      >
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
  render() {
    return html`
      <o-modal
        disableContentScroll
        title="${translateText("user_setting.title")}"
      >
        <div class="flex flex-col h-[70vh] max-h-[70vh]">
          <div
            class="background-panel p-1 flex border-b border-borderBase mb-4"
          >
            <button
              class="flex-1 flex items-center justify-center gap-2 px-6 py-2 font-title text-small transition-all 
      ${this.settingsMode === "basic"
                ? "bg-primary text-textLight"
                : "text-textGrey hover:text-textLight hover:bg-backgroundGrey"}"
              @click=${() => (this.settingsMode = "basic")}
            >
              ${translateText("user_setting.tab_basic")}
            </button>
            <button
              class="flex-1 flex items-center justify-center gap-2 px-6 py-2 font-title text-small transition-all
      ${this.settingsMode === "keybinds"
                ? "bg-primary text-textLight"
                : "text-textGrey hover:text-textLight hover:bg-backgroundGrey"}"
              @click=${() => (this.settingsMode = "keybinds")}
            >
              ${translateText("user_setting.tab_keybinds")}
            </button>
          </div>
          <div class="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
            ${this.settingsMode === "basic"
              ? this.renderBasicSettings()
              : this.renderKeybindSettings()}
          </div>
        </div>
      </o-modal>
    `;
  }
}
