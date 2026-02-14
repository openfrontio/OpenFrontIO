import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { formatKeyForDisplay, translateText } from "../client/Utils";
import { UserSettings } from "../core/game/UserSettings";
import "./components/baseComponents/setting/SettingKeybind";
import { SettingKeybind } from "./components/baseComponents/setting/SettingKeybind";
import "./components/baseComponents/setting/SettingNumber";
import "./components/baseComponents/setting/SettingSlider";
import "./components/baseComponents/setting/SettingToggle";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import "./FlagInputModal";

interface FlagInputModalElement extends HTMLElement {
  open(): void;
  returnTo?: string;
}

const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

const DefaultKeybinds: Record<string, string> = {
  toggleView: "Space",
  buildCity: "Digit1",
  buildFactory: "Digit2",
  buildPort: "Digit3",
  buildDefensePost: "Digit4",
  buildMissileSilo: "Digit5",
  buildSamLauncher: "Digit6",
  buildWarship: "Digit7",
  buildAtomBomb: "Digit8",
  buildHydrogenBomb: "Digit9",
  buildMIRV: "Digit0",
  attackRatioDown: "KeyT",
  attackRatioUp: "KeyY",
  boatAttack: "KeyB",
  groundAttack: "KeyG",
  swapDirection: "KeyU",
  zoomOut: "KeyQ",
  zoomIn: "KeyE",
  centerCamera: "KeyC",
  moveUp: "KeyW",
  moveLeft: "KeyA",
  moveDown: "KeyS",
  moveRight: "KeyD",
  modifierKey: isMac ? "MetaLeft" : "ControlLeft",
  altKey: "AltLeft",
};

@customElement("user-setting")
export class UserSettingModal extends BaseModal {
  private userSettings: UserSettings = new UserSettings();

  @state() private activeTab: "basic" | "keybinds" = "basic";

  @state() private keySequence: string[] = [];
  @state() private showEasterEggSettings = false;

  @state() private keybinds: Record<
    string,
    { value: string | string[]; key: string }
  > = {};

  connectedCallback() {
    super.connectedCallback();
    this.loadKeybindsFromStorage();
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleEasterEggKey);
    super.disconnectedCallback();
  }

  private loadKeybindsFromStorage() {
    const savedKeybinds = localStorage.getItem("settings.keybinds");
    if (!savedKeybinds) return;

    try {
      const parsed = JSON.parse(savedKeybinds);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        const isValid = Object.values(parsed).every((entry) => {
          if (
            typeof entry !== "object" ||
            entry === null ||
            Array.isArray(entry)
          ) {
            return false;
          }
          if (!("key" in entry) || typeof (entry as any).key !== "string") {
            return false;
          }
          if (!("value" in entry)) {
            return false;
          }
          const value = (entry as any).value;
          if (typeof value === "string") {
            return true;
          }
          if (Array.isArray(value)) {
            return value.every((v) => typeof v === "string");
          }
          return false;
        });

        if (isValid) {
          this.keybinds = parsed;
        } else {
          console.warn(
            "Invalid keybinds structure: entries must be objects with 'key' (string) and 'value' (string or string[]) properties. Ignoring saved data.",
          );
        }
      } else {
        console.warn(
          "Invalid keybinds data: expected non-array object. Ignoring saved data.",
        );
      }
    } catch (e) {
      console.warn("Invalid keybinds JSON:", e);
    }
  }

  private handleKeybindChange(
    e: CustomEvent<{
      action: string;
      value: string;
      key: string;
      prevValue?: string;
    }>,
  ) {
    const { action, value, key, prevValue } = e.detail;

    const activeKeybinds: Record<string, string> = { ...DefaultKeybinds };
    for (const [k, v] of Object.entries(this.keybinds)) {
      const normalizedValue = Array.isArray(v.value)
        ? v.value[0] || ""
        : v.value;
      if (normalizedValue === "Null") {
        delete activeKeybinds[k];
      } else {
        activeKeybinds[k] = normalizedValue;
      }
    }

    const values = Object.entries(activeKeybinds)
      .filter(([k]) => k !== action)
      .map(([, v]) => v);

    if (values.includes(value) && value !== "Null") {
      const displayKey = formatKeyForDisplay(key || value);
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: html`
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 text-red-500 inline-block align-middle mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span class="font-medium">
                ${(() => {
                  const message = translateText(
                    "user_setting.keybind_conflict_error",
                    { key: displayKey },
                  );
                  const parts = message.split(displayKey);
                  return html`${parts[0]}<span
                      class="font-mono font-bold bg-white/10 px-1.5 py-0.5 rounded text-red-200 mx-1 border border-white/10"
                      >${displayKey}</span
                    >${parts[1] || ""}`;
                })()}
              </span>
            `,
            color: "red",
            duration: 3000,
          },
        }),
      );

      const element = this.renderRoot.querySelector(
        `setting-keybind[action="${action}"]`,
      ) as SettingKeybind;
      if (element) {
        element.value = prevValue ?? DefaultKeybinds[action] ?? "";
        element.requestUpdate();
      }
      return;
    }

    this.keybinds = { ...this.keybinds, [action]: { value: value, key: key } };
    localStorage.setItem("settings.keybinds", JSON.stringify(this.keybinds));
  }

  private getKeyValue(action: string): string | undefined {
    const entry = this.keybinds[action];
    if (!entry) return undefined;
    const normalizedValue = Array.isArray(entry.value)
      ? entry.value[0] || ""
      : entry.value;
    if (normalizedValue === "Null") return "";
    return normalizedValue || undefined;
  }

  private getKeyChar(action: string): string {
    const entry = this.keybinds[action];
    if (!entry) return "";
    return entry.key || "";
  }

  private handleEasterEggKey = (e: KeyboardEvent) => {
    if (!this.isModalOpen || this.showEasterEggSettings) return;

    // Validate that the event target is inside this component
    const target = e.target as Node;
    if (!this.contains(target)) {
      return;
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
    console.log("🪺 Setting~ unlocked by EVAN combo!");
    this.showEasterEggSettings = true;
    const popup = document.createElement("div");
    popup.className =
      "fixed top-10 left-1/2 p-4 px-6 bg-black/80 text-white text-xl rounded-xl animate-fadePop z-[9999]";
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

    console.log("🌙 Dark Mode:", enabled ? "ON" : "OFF");
  }

  private toggleEmojis(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.emojis", enabled);

    console.log("🤡 Emojis:", enabled ? "ON" : "OFF");
  }

  private toggleAlertFrame(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.alertFrame", enabled);

    console.log("🚨 Alert frame:", enabled ? "ON" : "OFF");
  }

  private toggleFxLayer(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.specialEffects", enabled);

    console.log("💥 Special effects:", enabled ? "ON" : "OFF");
  }

  private toggleStructureSprites(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.structureSprites", enabled);

    console.log("🏠 Structure sprites:", enabled ? "ON" : "OFF");
  }

  private toggleCursorCostLabel(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.cursorCostLabel", enabled);

    console.log("💰 Cursor build cost:", enabled ? "ON" : "OFF");
  }

  private toggleAnonymousNames(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.anonymousNames", enabled);

    console.log("🙈 Anonymous Names:", enabled ? "ON" : "OFF");
  }

  private toggleLobbyIdVisibility(e: CustomEvent<{ checked: boolean }>) {
    const hideIds = e.detail?.checked;
    if (typeof hideIds !== "boolean") return;

    this.userSettings.set("settings.lobbyIdVisibility", !hideIds); // Invert because checked=hide
    console.log("👁️ Hidden Lobby IDs:", hideIds ? "ON" : "OFF");
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

  private toggleTerritoryPatterns(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.territoryPatterns", enabled);

    console.log("🏳️ Territory Patterns:", enabled ? "ON" : "OFF");
  }

  private togglePerformanceOverlay(e: CustomEvent<{ checked: boolean }>) {
    const enabled = e.detail?.checked;
    if (typeof enabled !== "boolean") return;

    this.userSettings.set("settings.performanceOverlay", enabled);
  }

  private openFlagSelector = () => {
    const flagInputModal =
      document.querySelector<FlagInputModalElement>("#flag-input-modal");
    if (flagInputModal?.open) {
      this.close();
      flagInputModal.returnTo = "#" + (this.id || "page-settings");
      flagInputModal.open();
    }
  };

  render() {
    const activeContent =
      this.activeTab === "basic"
        ? this.renderBasicSettings()
        : this.renderKeybindSettings();

    const content = html`
      <div class="${this.modalContainerClass}">
        <div
          class="relative flex flex-col border-b border-white/10 lg:pb-4 shrink-0"
        >
          ${modalHeader({
            title: translateText("user_setting.title"),
            onBack: () => this.close(),
            ariaLabel: translateText("common.back"),
            showDivider: true,
          })}

          <div class="hidden lg:flex items-center gap-2 justify-center mt-4">
            <button
              class="px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest ${this
                .activeTab === "basic"
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                : "text-white/40 hover:text-white hover:bg-white/5 border border-transparent"}"
              @click=${() => (this.activeTab = "basic")}
            >
              ${translateText("user_setting.tab_basic")}
            </button>
            <button
              class="px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest ${this
                .activeTab === "keybinds"
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                : "text-white/40 hover:text-white hover:bg-white/5 border border-transparent"}"
              @click=${() => (this.activeTab = "keybinds")}
            >
              ${translateText("user_setting.tab_keybinds")}
            </button>
          </div>
        </div>

        <div
          class="pt-6 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent px-6 pb-6 mr-1"
        >
          <div class="flex flex-col gap-2">${activeContent}</div>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        title="${translateText("user_setting.title")}"
        ?inline=${this.inline}
        hideCloseButton
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }

  protected onClose(): void {
    window.removeEventListener("keydown", this.handleEasterEggKey);
  }

  private renderKeybindSettings() {
    return html`
      <h2
        class="text-blue-200 text-xl font-bold mt-4 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.view_options")}
      </h2>

      <setting-keybind
        action="toggleView"
        label=${translateText("user_setting.toggle_view")}
        description=${translateText("user_setting.toggle_view_desc")}
        defaultKey="Space"
        .value=${this.getKeyValue("toggleView")}
        .display=${this.getKeyChar("toggleView")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.build_controls")}
      </h2>

      <setting-keybind
        action="buildCity"
        label=${translateText("user_setting.build_city")}
        description=${translateText("user_setting.build_city_desc")}
        defaultKey="Digit1"
        .value=${this.getKeyValue("buildCity")}
        .display=${this.getKeyChar("buildCity")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildFactory"
        label=${translateText("user_setting.build_factory")}
        description=${translateText("user_setting.build_factory_desc")}
        defaultKey="Digit2"
        .value=${this.getKeyValue("buildFactory")}
        .display=${this.getKeyChar("buildFactory")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildPort"
        label=${translateText("user_setting.build_port")}
        description=${translateText("user_setting.build_port_desc")}
        defaultKey="Digit3"
        .value=${this.getKeyValue("buildPort")}
        .display=${this.getKeyChar("buildPort")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildDefensePost"
        label=${translateText("user_setting.build_defense_post")}
        description=${translateText("user_setting.build_defense_post_desc")}
        defaultKey="Digit4"
        .value=${this.getKeyValue("buildDefensePost")}
        .display=${this.getKeyChar("buildDefensePost")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildMissileSilo"
        label=${translateText("user_setting.build_missile_silo")}
        description=${translateText("user_setting.build_missile_silo_desc")}
        defaultKey="Digit5"
        .value=${this.getKeyValue("buildMissileSilo")}
        .display=${this.getKeyChar("buildMissileSilo")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildSamLauncher"
        label=${translateText("user_setting.build_sam_launcher")}
        description=${translateText("user_setting.build_sam_launcher_desc")}
        defaultKey="Digit6"
        .value=${this.getKeyValue("buildSamLauncher")}
        .display=${this.getKeyChar("buildSamLauncher")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildWarship"
        label=${translateText("user_setting.build_warship")}
        description=${translateText("user_setting.build_warship_desc")}
        defaultKey="Digit7"
        .value=${this.getKeyValue("buildWarship")}
        .display=${this.getKeyChar("buildWarship")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildAtomBomb"
        label=${translateText("user_setting.build_atom_bomb")}
        description=${translateText("user_setting.build_atom_bomb_desc")}
        defaultKey="Digit8"
        .value=${this.getKeyValue("buildAtomBomb")}
        .display=${this.getKeyChar("buildAtomBomb")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildHydrogenBomb"
        label=${translateText("user_setting.build_hydrogen_bomb")}
        description=${translateText("user_setting.build_hydrogen_bomb_desc")}
        defaultKey="Digit9"
        .value=${this.getKeyValue("buildHydrogenBomb")}
        .display=${this.getKeyChar("buildHydrogenBomb")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="buildMIRV"
        label=${translateText("user_setting.build_mirv")}
        description=${translateText("user_setting.build_mirv_desc")}
        defaultKey="Digit0"
        .value=${this.getKeyValue("buildMIRV")}
        .display=${this.getKeyChar("buildMIRV")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.menu_shortcuts")}
      </h2>

      <setting-keybind
        action="modifierKey"
        label=${translateText("user_setting.build_menu_modifier")}
        description=${translateText("user_setting.build_menu_modifier_desc")}
        .defaultKey=${DefaultKeybinds.modifierKey}
        .value=${this.getKeyValue("modifierKey")}
        .display=${this.getKeyChar("modifierKey")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="altKey"
        label=${translateText("user_setting.emoji_menu_modifier")}
        description=${translateText("user_setting.emoji_menu_modifier_desc")}
        .defaultKey=${DefaultKeybinds.altKey}
        .value=${this.getKeyValue("altKey")}
        .display=${this.getKeyChar("altKey")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.attack_ratio_controls")}
      </h2>

      <setting-keybind
        action="attackRatioDown"
        label=${translateText("user_setting.attack_ratio_down")}
        description=${translateText("user_setting.attack_ratio_down_desc")}
        defaultKey="KeyT"
        .value=${this.getKeyValue("attackRatioDown")}
        .display=${this.getKeyChar("attackRatioDown")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="attackRatioUp"
        label=${translateText("user_setting.attack_ratio_up")}
        description=${translateText("user_setting.attack_ratio_up_desc")}
        defaultKey="KeyY"
        .value=${this.getKeyValue("attackRatioUp")}
        .display=${this.getKeyChar("attackRatioUp")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.attack_keybinds")}
      </h2>

      <setting-keybind
        action="boatAttack"
        label=${translateText("user_setting.boat_attack")}
        description=${translateText("user_setting.boat_attack_desc")}
        defaultKey="KeyB"
        .value=${this.getKeyValue("boatAttack")}
        .display=${this.getKeyChar("boatAttack")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="groundAttack"
        label=${translateText("user_setting.ground_attack")}
        description=${translateText("user_setting.ground_attack_desc")}
        defaultKey="KeyG"
        .value=${this.getKeyValue("groundAttack")}
        .display=${this.getKeyChar("groundAttack")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="swapDirection"
        label=${translateText("user_setting.swap_direction")}
        description=${translateText("user_setting.swap_direction_desc")}
        .defaultKey=${DefaultKeybinds.swapDirection}
        .value=${this.getKeyValue("swapDirection")}
        .display=${this.getKeyChar("swapDirection")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.zoom_controls")}
      </h2>

      <setting-keybind
        action="zoomOut"
        label=${translateText("user_setting.zoom_out")}
        description=${translateText("user_setting.zoom_out_desc")}
        defaultKey="KeyQ"
        .value=${this.getKeyValue("zoomOut")}
        .display=${this.getKeyChar("zoomOut")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="zoomIn"
        label=${translateText("user_setting.zoom_in")}
        description=${translateText("user_setting.zoom_in_desc")}
        defaultKey="KeyE"
        .value=${this.getKeyValue("zoomIn")}
        .display=${this.getKeyChar("zoomIn")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.camera_movement")}
      </h2>

      <setting-keybind
        action="centerCamera"
        label=${translateText("user_setting.center_camera")}
        description=${translateText("user_setting.center_camera_desc")}
        defaultKey="KeyC"
        .value=${this.getKeyValue("centerCamera")}
        .display=${this.getKeyChar("centerCamera")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveUp"
        label=${translateText("user_setting.move_up")}
        description=${translateText("user_setting.move_up_desc")}
        defaultKey="KeyW"
        .value=${this.getKeyValue("moveUp")}
        .display=${this.getKeyChar("moveUp")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveLeft"
        label=${translateText("user_setting.move_left")}
        description=${translateText("user_setting.move_left_desc")}
        defaultKey="KeyA"
        .value=${this.getKeyValue("moveLeft")}
        .display=${this.getKeyChar("moveLeft")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveDown"
        label=${translateText("user_setting.move_down")}
        description=${translateText("user_setting.move_down_desc")}
        defaultKey="KeyS"
        .value=${this.getKeyValue("moveDown")}
        .display=${this.getKeyChar("moveDown")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="moveRight"
        label=${translateText("user_setting.move_right")}
        description=${translateText("user_setting.move_right_desc")}
        defaultKey="KeyD"
        .value=${this.getKeyValue("moveRight")}
        .display=${this.getKeyChar("moveRight")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>
    `;
  }

  private renderBasicSettings() {
    return html`
      <!-- 🚩 Flag Selector -->
      <div
        class="flex flex-row items-center justify-between w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-4 cursor-pointer"
        role="button"
        tabindex="0"
        @click=${this.openFlagSelector}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.openFlagSelector();
          }
        }}
      >
        <div class="flex flex-col flex-1 min-w-0 mr-4">
          <div class="text-white font-bold text-base block mb-1">
            ${translateText("flag_input.title")}
          </div>
          <div class="text-white/50 text-sm leading-snug">
            ${translateText("flag_input.button_title")}
          </div>
        </div>

        <div
          class="relative inline-block w-12 h-8 shrink-0 rounded overflow-hidden border border-white/20"
        >
          <flag-input class="w-full h-full pointer-events-none"></flag-input>
        </div>
      </div>

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

      <!-- 🚨 Alert frame -->
      <setting-toggle
        label="${translateText("user_setting.alert_frame_label")}"
        description="${translateText("user_setting.alert_frame_desc")}"
        id="alert-frame-toggle"
        .checked=${this.userSettings.alertFrame()}
        @change=${this.toggleAlertFrame}
      ></setting-toggle>

      <!-- 💥 Special effects -->
      <setting-toggle
        label="${translateText("user_setting.special_effects_label")}"
        description="${translateText("user_setting.special_effects_desc")}"
        id="special-effect-toggle"
        .checked=${this.userSettings.fxLayer()}
        @change=${this.toggleFxLayer}
      ></setting-toggle>

      <!-- 🏠 Structure Sprites -->
      <setting-toggle
        label="${translateText("user_setting.structure_sprites_label")}"
        description="${translateText("user_setting.structure_sprites_desc")}"
        id="structure_sprites-toggle"
        .checked=${this.userSettings.structureSprites()}
        @change=${this.toggleStructureSprites}
      ></setting-toggle>

      <!-- 💰 Cursor Price Pill -->
      <setting-toggle
        label="${translateText("user_setting.cursor_cost_label_label")}"
        description="${translateText("user_setting.cursor_cost_label_desc")}"
        id="cursor_cost_label-toggle"
        .checked=${this.userSettings.cursorCostLabel()}
        @change=${this.toggleCursorCostLabel}
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

      <!-- 👁️ Hidden Lobby IDs -->
      <setting-toggle
        label="${translateText("user_setting.lobby_id_visibility_label")}"
        description="${translateText("user_setting.lobby_id_visibility_desc")}"
        id="lobby-id-visibility-toggle"
        .checked=${!this.userSettings.get("settings.lobbyIdVisibility", true)}
        @change=${this.toggleLobbyIdVisibility}
      ></setting-toggle>

      <!-- 🏳️ Territory Patterns -->
      <setting-toggle
        label="${translateText("user_setting.territory_patterns_label")}"
        description="${translateText("user_setting.territory_patterns_desc")}"
        id="territory-patterns-toggle"
        .checked=${this.userSettings.territoryPatterns()}
        @change=${this.toggleTerritoryPatterns}
      ></setting-toggle>

      <!-- 📱 Performance Overlay -->
      <setting-toggle
        label="${translateText("user_setting.performance_overlay_label")}"
        description="${translateText("user_setting.performance_overlay_desc")}"
        id="performance-overlay-toggle"
        .checked=${this.userSettings.performanceOverlay()}
        @change=${this.togglePerformanceOverlay}
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

  protected onOpen(): void {
    window.addEventListener("keydown", this.handleEasterEggKey);
    this.loadKeybindsFromStorage();
  }

  public open() {
    super.open();
  }
}
