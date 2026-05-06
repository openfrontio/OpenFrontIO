import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { formatKeyForDisplay, translateText } from "../client/Utils";
import { getDefaultKeybinds, UserSettings } from "../core/game/UserSettings";
import "./components/baseComponents/setting/SettingKeybind";
import { SettingKeybind } from "./components/baseComponents/setting/SettingKeybind";
import "./components/baseComponents/setting/SettingNumber";
import "./components/baseComponents/setting/SettingSelect";
import "./components/baseComponents/setting/SettingSlider";
import "./components/baseComponents/setting/SettingToggle";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { Platform } from "./Platform";

@customElement("user-setting")
export class UserSettingModal extends BaseModal {
  private userSettings: UserSettings = new UserSettings();
  private readonly defaultKeybinds = getDefaultKeybinds(Platform.isMac);

  @state() private activeTab: "basic" | "keybinds" = "basic";

  @state() private keySequence: string[] = [];
  @state() private showEasterEggSettings = false;

  @state() private userKeybinds: Record<
    string,
    { value: string; key: string }
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
    const parsed = this.userSettings.parsedUserKeybinds();
    if (Object.keys(parsed).length === 0) {
      this.userKeybinds = {};
      return;
    }

    const validated: Record<string, { value: string; key: string }> = {};

    for (const [action, entry] of Object.entries(parsed)) {
      if (typeof entry === "string") {
        validated[action] = { value: entry, key: entry };
      } else if (
        typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry)
      ) {
        const rawValue = (entry as any).value ?? "Null";
        const value = Array.isArray(rawValue)
          ? rawValue.find((v) => typeof v === "string")
          : rawValue;

        const rawKey = (entry as any).key ?? value;
        const key = Array.isArray(rawKey)
          ? rawKey.find((v) => typeof v === "string")
          : rawKey;

        if (typeof value === "string" && typeof key === "string") {
          validated[action] = { value, key };
        }
      }
    }

    this.userKeybinds = validated;
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

    const activeKeybinds = { ...this.defaultKeybinds };
    for (const [k, v] of Object.entries(this.userKeybinds)) {
      const normalizedValue = v.value;
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

      const element = this.renderRoot.querySelector<SettingKeybind>(
        `setting-keybind[action="${action}"]`,
      );
      if (element) {
        element.value = prevValue ?? this.defaultKeybinds[action] ?? "";
        element.requestUpdate();
      }
      return;
    }

    this.userKeybinds = {
      ...this.userKeybinds,
      [action]: { value: value, key: key },
    };
    this.userSettings.setKeybinds(this.userKeybinds);
  }

  private getKeyValue(action: string): string | undefined {
    const entry = this.userKeybinds[action];
    if (!entry) return undefined;
    const normalizedValue = entry.value;
    if (normalizedValue === "Null") return "";
    return normalizedValue || undefined;
  }

  private getKeyChar(action: string): string {
    const entry = this.userKeybinds[action];
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

  toggleDarkMode() {
    this.userSettings.toggleDarkMode();

    console.log("🌙 Dark Mode:", this.userSettings.darkMode() ? "ON" : "OFF");
  }

  private toggleEmojis() {
    this.userSettings.toggleEmojis();

    console.log("🤡 Emojis:", this.userSettings.emojis() ? "ON" : "OFF");
  }

  private toggleAlertFrame() {
    this.userSettings.toggleAlertFrame();

    console.log(
      "🚨 Alert frame:",
      this.userSettings.alertFrame() ? "ON" : "OFF",
    );
  }

  private toggleFxLayer() {
    this.userSettings.toggleFxLayer();

    console.log(
      "💥 Special effects:",
      this.userSettings.fxLayer() ? "ON" : "OFF",
    );
  }

  private toggleStructureSprites() {
    this.userSettings.toggleStructureSprites();

    console.log(
      "🏠 Structure sprites:",
      this.userSettings.structureSprites() ? "ON" : "OFF",
    );
  }

  private toggleCursorCostLabel() {
    this.userSettings.toggleCursorCostLabel();

    console.log(
      "💰 Cursor build cost:",
      this.userSettings.cursorCostLabel() ? "ON" : "OFF",
    );
  }

  private toggleAnonymousNames() {
    this.userSettings.toggleRandomName();

    console.log(
      "🙈 Anonymous Names:",
      this.userSettings.anonymousNames() ? "ON" : "OFF",
    );
  }

  private toggleLobbyIdVisibility() {
    this.userSettings.toggleLobbyIdVisibility();
    console.log(
      "👁️ Hidden Lobby IDs:",
      !this.userSettings.lobbyIdVisibility() ? "ON" : "OFF",
    );
  }

  private toggleLeftClickOpensMenu() {
    this.userSettings.toggleLeftClickOpenMenu();
    console.log(
      "🖱️ Left Click Opens Menu:",
      this.userSettings.leftClickOpensMenu() ? "ON" : "OFF",
    );

    this.requestUpdate();
  }

  private sliderAttackRatio(e: CustomEvent<{ value: number }>) {
    const value = e.detail?.value;
    if (typeof value === "number") {
      const ratio = value / 100;
      this.userSettings.setAttackRatio(ratio);
    } else {
      console.warn("Slider event missing detail.value", e);
    }
  }

  private changeAttackRatioIncrement(
    e: CustomEvent<{ value: number | string }>,
  ) {
    const rawValue = e.detail?.value;
    const value =
      typeof rawValue === "number" ? rawValue : parseInt(String(rawValue), 10);
    if (!Number.isFinite(value)) {
      console.warn("Select event missing detail.value", e);
      return;
    }
    this.userSettings.setAttackRatioIncrement(Math.round(value));
    this.requestUpdate();
  }

  private toggleTerritoryPatterns() {
    this.userSettings.toggleTerritoryPatterns();

    console.log(
      "🏳️ Territory Patterns:",
      this.userSettings.territoryPatterns() ? "ON" : "OFF",
    );
  }

  private togglePerformanceOverlay() {
    this.userSettings.togglePerformanceOverlay();
  }

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
                ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30 shadow-[var(--shadow-malibu-blue)]"
                : "text-white/40 hover:text-white hover:bg-white/5 border border-transparent"}"
              @click=${() => (this.activeTab = "basic")}
            >
              ${translateText("user_setting.tab_basic")}
            </button>
            <button
              class="px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest ${this
                .activeTab === "keybinds"
                ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30 shadow-[var(--shadow-malibu-blue)]"
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
      <div
        class="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300/70 text-xs"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-3.5 w-3.5 shrink-0 opacity-70"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        ${translateText("user_setting.keybinds_hint")}
      </div>

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

      <setting-keybind
        action="coordinateGrid"
        label=${translateText("user_setting.coordinate_grid_label")}
        description=${translateText("user_setting.coordinate_grid_desc")}
        defaultKey=${this.defaultKeybinds.coordinateGrid}
        .value=${this.getKeyValue("coordinateGrid")}
        .display=${this.getKeyChar("coordinateGrid")}
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
        .defaultKey=${this.defaultKeybinds.modifierKey}
        .value=${this.getKeyValue("modifierKey")}
        .display=${this.getKeyChar("modifierKey")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="altKey"
        label=${translateText("user_setting.emoji_menu_modifier")}
        description=${translateText("user_setting.emoji_menu_modifier_desc")}
        .defaultKey=${this.defaultKeybinds.altKey}
        .value=${this.getKeyValue("altKey")}
        .display=${this.getKeyChar("altKey")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="pauseGame"
        label=${translateText("user_setting.pause_game")}
        description=${translateText("user_setting.pause_game_desc")}
        .defaultKey=${this.defaultKeybinds.pauseGame}
        .value=${this.getKeyValue("pauseGame")}
        .display=${this.getKeyChar("pauseGame")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="gameSpeedUp"
        label=${translateText("user_setting.game_speed_up")}
        description=${translateText("user_setting.game_speed_up_desc")}
        .defaultKey=${this.defaultKeybinds.gameSpeedUp}
        .value=${this.getKeyValue("gameSpeedUp")}
        .display=${this.getKeyChar("gameSpeedUp")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="gameSpeedDown"
        label=${translateText("user_setting.game_speed_down")}
        description=${translateText("user_setting.game_speed_down_desc")}
        .defaultKey=${this.defaultKeybinds.gameSpeedDown}
        .value=${this.getKeyValue("gameSpeedDown")}
        .display=${this.getKeyChar("gameSpeedDown")}
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
        description=${translateText("user_setting.attack_ratio_down_desc", {
          amount: this.userSettings.attackRatioIncrement(),
        })}
        defaultKey="KeyT"
        .value=${this.getKeyValue("attackRatioDown")}
        .display=${this.getKeyChar("attackRatioDown")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="attackRatioUp"
        label=${translateText("user_setting.attack_ratio_up")}
        description=${translateText("user_setting.attack_ratio_up_desc", {
          amount: this.userSettings.attackRatioIncrement(),
        })}
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
        action="retaliateAttack"
        label=${translateText("user_setting.retaliate_attack")}
        description=${translateText("user_setting.retaliate_attack_desc")}
        defaultKey="Shift+KeyR"
        .value=${this.getKeyValue("retaliateAttack")}
        .display=${this.getKeyChar("retaliateAttack")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="swapDirection"
        label=${translateText("user_setting.swap_direction")}
        description=${translateText("user_setting.swap_direction_desc")}
        .defaultKey=${this.defaultKeybinds.swapDirection}
        .value=${this.getKeyValue("swapDirection")}
        .display=${this.getKeyChar("swapDirection")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.ally_keybinds")}
      </h2>

      <setting-keybind
        action="requestAlliance"
        label=${translateText("user_setting.request_alliance")}
        description=${translateText("user_setting.request_alliance_desc")}
        defaultKey="KeyK"
        .value=${this.getKeyValue("requestAlliance")}
        .display=${this.getKeyChar("requestAlliance")}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action="breakAlliance"
        label=${translateText("user_setting.break_alliance")}
        description=${translateText("user_setting.break_alliance_desc")}
        defaultKey="KeyL"
        .value=${this.getKeyValue("breakAlliance")}
        .display=${this.getKeyChar("breakAlliance")}
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
      <!-- 🌙 Dark Mode -->
      <setting-toggle
        label="${translateText("user_setting.dark_mode_label")}"
        description="${translateText("user_setting.dark_mode_desc")}"
        id="dark-mode-toggle"
        .checked=${this.userSettings.darkMode()}
        @change=${this.toggleDarkMode}
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
        .checked=${!this.userSettings.lobbyIdVisibility()}
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
        .value=${this.userSettings.attackRatio() * 100}
        @change=${this.sliderAttackRatio}
      ></setting-slider>

      <!-- ⚔️ Attack Ratio Increment -->
      <setting-select
        label=${translateText("user_setting.attack_ratio_increment_label")}
        description=${translateText("user_setting.attack_ratio_increment_desc")}
        .options=${[
          { value: 1, label: "1%" },
          { value: 2, label: "2%" },
          { value: 5, label: "5%" },
          { value: 10, label: "10%" },
          { value: 20, label: "20%" },
        ]}
        .value=${String(this.userSettings.attackRatioIncrement())}
        @change=${this.changeAttackRatioIncrement}
      ></setting-select>

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
