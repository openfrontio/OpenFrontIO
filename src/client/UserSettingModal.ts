import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { ThemeMode, UserSettings } from "../core/game/UserSettings";
import "./components/baseComponents/setting/SettingGroup";
import "./components/baseComponents/setting/SettingKeybind";
import { SettingKeybind } from "./components/baseComponents/setting/SettingKeybind";
import "./components/baseComponents/setting/SettingNumber";
import "./components/baseComponents/setting/SettingPlaceholder";
import "./components/baseComponents/setting/SettingSlider";
import "./components/baseComponents/setting/SettingThemeMode";
import "./components/baseComponents/setting/SettingToggle";

@customElement("user-setting")
export class UserSettingModal extends LitElement {
  private userSettings: UserSettings = new UserSettings();

  @state() private settingsMode: "basic" | "keybinds" | "display" = "basic";
  @state() private keybinds: Record<string, { value: string; key: string }> =
    {};

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

    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }

    const key = e.key.toLowerCase();
    const nextSequence = [...this.keySequence, key].slice(-4);
    this.keySequence = nextSequence;

    if (nextSequence.join("") === "evan") {
      this.triggerEasterEgg();
      this.keySequence = [];
    }
  };

  private triggerEasterEgg() {
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

    this.dispatchEvent(
      new CustomEvent("dark-mode-changed", {
        detail: { darkMode: enabled },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private toggleEmojis(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.emojis", enabled);
  }

  private toggleAlertFrame(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.alertFrame", enabled);
  }

  private toggleFxLayer(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.specialEffects", enabled);
  }

  private toggleStructureSprites(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.structureSprites", enabled);
  }

  private toggleCursorCostLabel(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.cursorCostLabel", enabled);
  }

  private toggleAnonymousNames(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.anonymousNames", enabled);
  }

  private toggleLobbyIdVisibility(e: CustomEvent<{ checked: boolean }>) {
    const hideIds = e.detail?.checked;
    if (typeof hideIds !== "boolean") return;

    this.userSettings.set("settings.lobbyIdVisibility", !hideIds); // Invert because checked=hide
  }

  private toggleLeftClickOpensMenu(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.leftClickOpensMenu", enabled);
    this.requestUpdate();
  }

  private sliderAttackRatio(e: CustomEvent<{ value: number }>) {
    const value = e.detail?.value;
    if (typeof value === "number") {
      const ratio = value / 100;
      localStorage.setItem("settings.attackRatio", ratio.toString());
    }
  }

  private toggleTerritoryPatterns(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.territoryPatterns", enabled);
  }

  private togglePerformanceOverlay(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.performanceOverlay", enabled);
  }

  private handleKeybindChange(
    e: CustomEvent<{ action: string; value: string; key: string }>,
  ) {
    const { action, value, key } = e.detail;
    const prevValue = this.keybinds[action]?.value ?? "";

    const values = Object.entries(this.keybinds)
      .filter(([k]) => k !== action)
      .map(([, v]) => v.value);
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
    this.keybinds = { ...this.keybinds, [action]: { value: value, key: key } };
    localStorage.setItem("settings.keybinds", JSON.stringify(this.keybinds));
  }

  render() {
    return html`
      <o-modal title="${translateText("user_setting.title")}">
        <div class="modal-overlay">
          <div
            class="modal-content user-setting-modal user-setting-modal--wide"
          >
            <div class="settings-tabs flex w-full justify-center">
              <button
                class="settings-tab flex-1 text-center px-3 py-1 rounded-l
      ${this.settingsMode === "basic" ? "settings-tab--active" : ""}"
                @click=${() => (this.settingsMode = "basic")}
              >
                ${translateText("user_setting.tab_basic")}
              </button>
              <button
                class="settings-tab flex-1 text-center px-3 py-1
      ${this.settingsMode === "keybinds" ? "settings-tab--active" : ""}"
                @click=${() => (this.settingsMode = "keybinds")}
              >
                ${translateText("user_setting.tab_keybinds")}
              </button>
              <button
                class="settings-tab flex-1 text-center px-3 py-1 rounded-r
      ${this.settingsMode === "display" ? "settings-tab--active" : ""}"
                @click=${() => (this.settingsMode = "display")}
              >
                ${translateText("user_setting.tab_display")}
              </button>
            </div>

            <div class="settings-list settings-list--grouped">
              ${this.settingsMode === "basic"
                ? this.renderBasicSettings()
                : this.settingsMode === "keybinds"
                  ? this.renderKeybindSettings()
                  : this.renderDisplaySettings()}
            </div>
          </div>
        </div>
      </o-modal>
    `;
  }

  private handleThemeModeChange(e: CustomEvent<{ mode: ThemeMode }>) {
    const mode = e.detail?.mode;
    if (mode) {
      this.userSettings.setThemeMode(mode);
      this.dispatchEvent(
        new CustomEvent("theme-mode-changed", {
          detail: { mode },
          bubbles: true,
          composed: true,
        }),
      );
      // Dispatch dark-mode-changed for DarkModeButton sync
      window.dispatchEvent(
        new CustomEvent("dark-mode-changed", {
          detail: { darkMode: this.userSettings.isDarkModeActive() },
        }),
      );
    }
  }

  private renderDisplaySettings() {
    return html`
      <!-- Theme Settings -->
      <setting-group
        label="${translateText("user_setting.group_theme")}"
        groupId="theme"
      >
        <setting-theme-mode
          label="${translateText("user_setting.theme_mode_label")}"
          description="${translateText("user_setting.theme_mode_desc")}"
          @change=${this.handleThemeModeChange}
        ></setting-theme-mode>
      </setting-group>

      <!-- Cosmetics - Skins -->
      <setting-group
        label="${translateText("user_setting.group_skins")}"
        groupId="skins"
      >
        <setting-placeholder
          image="/images/placeholders/placeholder-display-theme-manager.jpg"
          alt="${translateText("user_setting.skins_preview_alt")}"
        ></setting-placeholder>
      </setting-group>

      <!-- Cosmetics - Colors -->
      <setting-group
        label="${translateText("user_setting.group_colors")}"
        groupId="colors"
      >
        <setting-placeholder
          image="/images/placeholders/placeholder-display-color-manager.jpg"
          alt="${translateText("user_setting.colors_preview_alt")}"
        ></setting-placeholder>
      </setting-group>
    `;
  }

  private renderBasicSettings() {
    return html`
      <!-- Interface Settings -->
      <setting-group
        label="${translateText("user_setting.group_interface")}"
        groupId="interface"
        columns
      >
        <setting-toggle
          label="${translateText("user_setting.alert_frame_label")}"
          description="${translateText("user_setting.alert_frame_desc")}"
          id="alert-frame-toggle"
          .checked=${this.userSettings.alertFrame()}
          @change=${this.toggleAlertFrame}
        ></setting-toggle>

        <setting-toggle
          label="${translateText("user_setting.territory_patterns_label")}"
          description="${translateText("user_setting.territory_patterns_desc")}"
          id="territory-patterns-toggle"
          .checked=${this.userSettings.territoryPatterns()}
          @change=${this.toggleTerritoryPatterns}
        ></setting-toggle>

        <setting-toggle
          label="${translateText("user_setting.emojis_label")}"
          description="${translateText("user_setting.emojis_desc")}"
          id="emoji-toggle"
          .checked=${this.userSettings.emojis()}
          @change=${this.toggleEmojis}
        ></setting-toggle>
      </setting-group>

      <!-- Graphics Settings -->
      <setting-group
        label="${translateText("user_setting.group_graphics")}"
        groupId="graphics"
        columns
      >
        <setting-toggle
          label="${translateText("user_setting.performance_overlay_label")}"
          description="${translateText(
            "user_setting.performance_overlay_desc",
          )}"
          id="performance-overlay-toggle"
          .checked=${this.userSettings.performanceOverlay()}
          @change=${this.togglePerformanceOverlay}
        ></setting-toggle>

        <setting-toggle
          label="${translateText("user_setting.special_effects_label")}"
          description="${translateText("user_setting.special_effects_desc")}"
          id="special-effect-toggle"
          .checked=${this.userSettings.fxLayer()}
          @change=${this.toggleFxLayer}
        ></setting-toggle>

        <setting-toggle
          label="${translateText("user_setting.structure_sprites_label")}"
          description="${translateText("user_setting.structure_sprites_desc")}"
          id="structure_sprites-toggle"
          .checked=${this.userSettings.structureSprites()}
          @change=${this.toggleStructureSprites}
        ></setting-toggle>

        <setting-toggle
          label="${translateText("user_setting.cursor_cost_label_label")}"
          description="${translateText("user_setting.cursor_cost_label_desc")}"
          id="cursor_cost_label-toggle"
          .checked=${this.userSettings.cursorCostLabel()}
          @change=${this.toggleCursorCostLabel}
        ></setting-toggle>
      </setting-group>

      <!-- Controls Settings -->
      <setting-group
        label="${translateText("user_setting.group_controls")}"
        groupId="controls"
        columns
      >
        <setting-toggle
          label="${translateText("user_setting.left_click_label")}"
          description="${translateText("user_setting.left_click_desc")}"
          id="left-click-toggle"
          .checked=${this.userSettings.leftClickOpensMenu()}
          @change=${this.toggleLeftClickOpensMenu}
        ></setting-toggle>

        <setting-slider
          label="${translateText("user_setting.attack_ratio_label")}"
          description="${translateText("user_setting.attack_ratio_desc")}"
          min="1"
          max="100"
          .value=${(() => {
            const stored = localStorage.getItem("settings.attackRatio");
            const parsed = stored !== null ? Number(stored) : 0.2;
            return (Number.isNaN(parsed) ? 0.2 : parsed) * 100;
          })()}
          @change=${this.sliderAttackRatio}
        ></setting-slider>
      </setting-group>

      <!-- Privacy Settings -->
      <setting-group
        label="${translateText("user_setting.group_privacy")}"
        groupId="privacy"
        columns
      >
        <setting-toggle
          label="${translateText("user_setting.anonymous_names_label")}"
          description="${translateText("user_setting.anonymous_names_desc")}"
          id="anonymous-names-toggle"
          .checked=${this.userSettings.anonymousNames()}
          @change=${this.toggleAnonymousNames}
        ></setting-toggle>

        <setting-toggle
          label="${translateText("user_setting.lobby_id_visibility_label")}"
          description="${translateText(
            "user_setting.lobby_id_visibility_desc",
          )}"
          id="lobby-id-visibility-toggle"
          .checked=${!this.userSettings.get("settings.lobbyIdVisibility", true)}
          @change=${this.toggleLobbyIdVisibility}
        ></setting-toggle>
      </setting-group>

      ${this.showEasterEggSettings
        ? html`
            <setting-group
              label="${translateText("user_setting.group_easter")}"
              groupId="easter"
              columns
            >
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
              ></setting-number>
            </setting-group>
          `
        : null}
    `;
  }

  private renderKeybindSettings() {
    return html`
      <!-- View Options -->
      <setting-group
        label="${translateText("user_setting.view_options")}"
        groupId="keybinds-view"
        columns
      >
        <setting-keybind
          action="toggleView"
          label=${translateText("user_setting.toggle_view")}
          description=${translateText("user_setting.toggle_view_desc")}
          defaultKey="Backslash"
          .value=${this.keybinds["toggleView"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>
      </setting-group>

      <!-- Build Controls -->
      <setting-group
        label="${translateText("user_setting.build_controls")}"
        groupId="keybinds-build"
        columns
      >
        <setting-keybind
          action="buildCity"
          label=${translateText("user_setting.build_city")}
          description=${translateText("user_setting.build_city_desc")}
          defaultKey="Digit1"
          .value=${this.keybinds["buildCity"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="buildFactory"
          label=${translateText("user_setting.build_factory")}
          description=${translateText("user_setting.build_factory_desc")}
          defaultKey="Digit2"
          .value=${this.keybinds["buildFactory"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="buildPort"
          label=${translateText("user_setting.build_port")}
          description=${translateText("user_setting.build_port_desc")}
          defaultKey="Digit3"
          .value=${this.keybinds["buildPort"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="buildDefensePost"
          label=${translateText("user_setting.build_defense_post")}
          description=${translateText("user_setting.build_defense_post_desc")}
          defaultKey="Digit4"
          .value=${this.keybinds["buildDefensePost"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="buildMissileSilo"
          label=${translateText("user_setting.build_missile_silo")}
          description=${translateText("user_setting.build_missile_silo_desc")}
          defaultKey="Digit5"
          .value=${this.keybinds["buildMissileSilo"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="buildSamLauncher"
          label=${translateText("user_setting.build_sam_launcher")}
          description=${translateText("user_setting.build_sam_launcher_desc")}
          defaultKey="Digit6"
          .value=${this.keybinds["buildSamLauncher"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="buildWarship"
          label=${translateText("user_setting.build_warship")}
          description=${translateText("user_setting.build_warship_desc")}
          defaultKey="Digit7"
          .value=${this.keybinds["buildWarship"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="buildAtomBomb"
          label=${translateText("user_setting.build_atom_bomb")}
          description=${translateText("user_setting.build_atom_bomb_desc")}
          defaultKey="Digit8"
          .value=${this.keybinds["buildAtomBomb"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="buildHydrogenBomb"
          label=${translateText("user_setting.build_hydrogen_bomb")}
          description=${translateText("user_setting.build_hydrogen_bomb_desc")}
          defaultKey="Digit9"
          .value=${this.keybinds["buildHydrogenBomb"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="buildMIRV"
          label=${translateText("user_setting.build_mirv")}
          description=${translateText("user_setting.build_mirv_desc")}
          defaultKey="Digit0"
          .value=${this.keybinds["buildMIRV"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>
      </setting-group>

      <!-- Attack Controls -->
      <setting-group
        label="${translateText("user_setting.attack_keybinds")}"
        groupId="keybinds-attack"
        columns
      >
        <setting-keybind
          action="boatAttack"
          label=${translateText("user_setting.boat_attack")}
          description=${translateText("user_setting.boat_attack_desc")}
          defaultKey="KeyB"
          .value=${this.keybinds["boatAttack"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="groundAttack"
          label=${translateText("user_setting.ground_attack")}
          description=${translateText("user_setting.ground_attack_desc")}
          defaultKey="KeyG"
          .value=${this.keybinds["groundAttack"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="attackRatioDown"
          label=${translateText("user_setting.attack_ratio_down")}
          description=${translateText("user_setting.attack_ratio_down_desc")}
          defaultKey="KeyT"
          .value=${this.keybinds["attackRatioDown"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="attackRatioUp"
          label=${translateText("user_setting.attack_ratio_up")}
          description=${translateText("user_setting.attack_ratio_up_desc")}
          defaultKey="KeyY"
          .value=${this.keybinds["attackRatioUp"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>
      </setting-group>

      <!-- Camera Controls -->
      <setting-group
        label="${translateText("user_setting.camera_movement")}"
        groupId="keybinds-camera"
        columns
      >
        <setting-keybind
          action="zoomOut"
          label=${translateText("user_setting.zoom_out")}
          description=${translateText("user_setting.zoom_out_desc")}
          defaultKey="KeyQ"
          .value=${this.keybinds["zoomOut"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="zoomIn"
          label=${translateText("user_setting.zoom_in")}
          description=${translateText("user_setting.zoom_in_desc")}
          defaultKey="KeyE"
          .value=${this.keybinds["zoomIn"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="centerCamera"
          label=${translateText("user_setting.center_camera")}
          description=${translateText("user_setting.center_camera_desc")}
          defaultKey="KeyC"
          .value=${this.keybinds["centerCamera"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="moveUp"
          label=${translateText("user_setting.move_up")}
          description=${translateText("user_setting.move_up_desc")}
          defaultKey="KeyW"
          .value=${this.keybinds["moveUp"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="moveLeft"
          label=${translateText("user_setting.move_left")}
          description=${translateText("user_setting.move_left_desc")}
          defaultKey="KeyA"
          .value=${this.keybinds["moveLeft"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="moveDown"
          label=${translateText("user_setting.move_down")}
          description=${translateText("user_setting.move_down_desc")}
          defaultKey="KeyS"
          .value=${this.keybinds["moveDown"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>

        <setting-keybind
          action="moveRight"
          label=${translateText("user_setting.move_right")}
          description=${translateText("user_setting.move_right_desc")}
          defaultKey="KeyD"
          .value=${this.keybinds["moveRight"]?.key ?? ""}
          @change=${this.handleKeybindChange}
        ></setting-keybind>
      </setting-group>
    `;
  }

  public open() {
    this.requestUpdate();
    this.modalEl?.open();
    // Force reflow after modal opens to fix initial render issues with columns layout
    requestAnimationFrame(() => {
      this.requestUpdate();
    });
  }

  public close() {
    this.modalEl?.close();
  }
}
