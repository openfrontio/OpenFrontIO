import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { formatKeyForDisplay, translateText } from "../client/Utils";
import {
  getDefaultKeybinds,
  KeybindAction,
  KeyUnbound,
  UserSettings,
} from "../core/game/UserSettings";
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

  @state() private userKeybinds: Partial<
    Record<KeybindAction, { value: string; key: string }>
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

    const validated: Partial<
      Record<KeybindAction, { value: string; key: string }>
    > = {};

    for (const [action, entry] of Object.entries(parsed)) {
      if (typeof entry === "string") {
        validated[action] = { value: entry, key: entry };
      } else if (
        typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry)
      ) {
        const rawValue = entry.value ?? KeyUnbound;
        const value = Array.isArray(rawValue)
          ? rawValue.find((v) => typeof v === "string")
          : rawValue;

        const rawKey = entry.key ?? value;
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
      action: KeybindAction;
      value: string;
      key: string;
      prevValue?: string;
    }>,
  ) {
    let { action, value, key, prevValue } = e.detail;

    console.info(
      "handleKeybindChange recieved value: " + value,
      ", key: " + key,
    );

    // Don't display "Dead" for Quote / Backquote https://en.wikipedia.org/wiki/QWERTY#US-International
    // nor "Unidentified" for some keys in Firefox ("" in Chrome). Empty the key to use value (key code).
    key = key === "Dead" || key === "Unidentified" ? "" : key;

    const activeKeybinds = { ...this.defaultKeybinds };
    for (const [action, codeAndKey] of Object.entries(this.userKeybinds)) {
      const normalizedCode = codeAndKey.value;
      if (normalizedCode === KeyUnbound) {
        delete activeKeybinds[action];
      } else {
        activeKeybinds[action] = normalizedCode;
      }
    }

    const codes = Object.entries(activeKeybinds)
      .filter(([a]) => a !== action)
      .map(([, code]) => code);

    if (codes.includes(value) && value !== KeyUnbound) {
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
      }
      return;
    }

    this.userKeybinds = {
      ...this.userKeybinds,
      [action]: { value: value, key: key },
    };
    this.userSettings.setUserKeybinds(this.userKeybinds);
  }

  private getKeyValue(action: KeybindAction): string | undefined {
    const entry = this.userKeybinds[action];
    if (!entry) return undefined;
    const normalizedValue = entry.value;
    if (normalizedValue === KeyUnbound) return "";
    return normalizedValue || undefined;
  }

  private getKeyChar(action: KeybindAction): string {
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
        action=${KeybindAction.toggleView}
        label=${translateText("user_setting.toggle_view")}
        description=${translateText("user_setting.toggle_view_desc")}
        .defaultKey=${this.defaultKeybinds.toggleView}
        .value=${this.getKeyValue(KeybindAction.toggleView)}
        .display=${this.getKeyChar(KeybindAction.toggleView)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.coordinateGrid}
        label=${translateText("user_setting.coordinate_grid_label")}
        description=${translateText("user_setting.coordinate_grid_desc")}
        .defaultKey=${this.defaultKeybinds.coordinateGrid}
        .value=${this.getKeyValue(KeybindAction.coordinateGrid)}
        .display=${this.getKeyChar(KeybindAction.coordinateGrid)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.build_controls")}
      </h2>

      <setting-keybind
        action=${KeybindAction.buildCity}
        label=${translateText("user_setting.build_city")}
        description=${translateText("user_setting.build_city_desc")}
        .defaultKey=${this.defaultKeybinds.buildCity}
        .value=${this.getKeyValue(KeybindAction.buildCity)}
        .display=${this.getKeyChar(KeybindAction.buildCity)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.buildFactory}
        label=${translateText("user_setting.build_factory")}
        description=${translateText("user_setting.build_factory_desc")}
        .defaultKey=${this.defaultKeybinds.buildFactory}
        .value=${this.getKeyValue(KeybindAction.buildFactory)}
        .display=${this.getKeyChar(KeybindAction.buildFactory)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.buildPort}
        label=${translateText("user_setting.build_port")}
        description=${translateText("user_setting.build_port_desc")}
        .defaultKey=${this.defaultKeybinds.buildPort}
        .value=${this.getKeyValue(KeybindAction.buildPort)}
        .display=${this.getKeyChar(KeybindAction.buildPort)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.buildDefensePost}
        label=${translateText("user_setting.build_defense_post")}
        description=${translateText("user_setting.build_defense_post_desc")}
        .defaultKey=${this.defaultKeybinds.buildDefensePost}
        .value=${this.getKeyValue(KeybindAction.buildDefensePost)}
        .display=${this.getKeyChar(KeybindAction.buildDefensePost)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.buildMissileSilo}
        label=${translateText("user_setting.build_missile_silo")}
        description=${translateText("user_setting.build_missile_silo_desc")}
        .defaultKey=${this.defaultKeybinds.buildMissileSilo}
        .value=${this.getKeyValue(KeybindAction.buildMissileSilo)}
        .display=${this.getKeyChar(KeybindAction.buildMissileSilo)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.buildSamLauncher}
        label=${translateText("user_setting.build_sam_launcher")}
        description=${translateText("user_setting.build_sam_launcher_desc")}
        .defaultKey=${this.defaultKeybinds.buildSamLauncher}
        .value=${this.getKeyValue(KeybindAction.buildSamLauncher)}
        .display=${this.getKeyChar(KeybindAction.buildSamLauncher)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.buildWarship}
        label=${translateText("user_setting.build_warship")}
        description=${translateText("user_setting.build_warship_desc")}
        .defaultKey=${this.defaultKeybinds.buildWarship}
        .value=${this.getKeyValue(KeybindAction.buildWarship)}
        .display=${this.getKeyChar(KeybindAction.buildWarship)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.buildAtomBomb}
        label=${translateText("user_setting.build_atom_bomb")}
        description=${translateText("user_setting.build_atom_bomb_desc")}
        .defaultKey=${this.defaultKeybinds.buildAtomBomb}
        .value=${this.getKeyValue(KeybindAction.buildAtomBomb)}
        .display=${this.getKeyChar(KeybindAction.buildAtomBomb)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.buildHydrogenBomb}
        label=${translateText("user_setting.build_hydrogen_bomb")}
        description=${translateText("user_setting.build_hydrogen_bomb_desc")}
        .defaultKey=${this.defaultKeybinds.buildHydrogenBomb}
        .value=${this.getKeyValue(KeybindAction.buildHydrogenBomb)}
        .display=${this.getKeyChar(KeybindAction.buildHydrogenBomb)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.buildMIRV}
        label=${translateText("user_setting.build_mirv")}
        description=${translateText("user_setting.build_mirv_desc")}
        .defaultKey=${this.defaultKeybinds.buildMIRV}
        .value=${this.getKeyValue(KeybindAction.buildMIRV)}
        .display=${this.getKeyChar(KeybindAction.buildMIRV)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.menu_shortcuts")}
      </h2>

      <setting-keybind
        action=${KeybindAction.buildMenuModifier}
        label=${translateText("user_setting.build_menu_modifier")}
        description=${translateText("user_setting.build_menu_modifier_desc")}
        .defaultKey=${this.defaultKeybinds.buildMenuModifier}
        .value=${this.getKeyValue(KeybindAction.buildMenuModifier)}
        .display=${this.getKeyChar(KeybindAction.buildMenuModifier)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.emojiMenuModifier}
        label=${translateText("user_setting.emoji_menu_modifier")}
        description=${translateText("user_setting.emoji_menu_modifier_desc")}
        .defaultKey=${this.defaultKeybinds.emojiMenuModifier}
        .value=${this.getKeyValue(KeybindAction.emojiMenuModifier)}
        .display=${this.getKeyChar(KeybindAction.emojiMenuModifier)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.pauseGame}
        label=${translateText("user_setting.pause_game")}
        description=${translateText("user_setting.pause_game_desc")}
        .defaultKey=${this.defaultKeybinds.pauseGame}
        .value=${this.getKeyValue(KeybindAction.pauseGame)}
        .display=${this.getKeyChar(KeybindAction.pauseGame)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.gameSpeedUp}
        label=${translateText("user_setting.game_speed_up")}
        description=${translateText("user_setting.game_speed_up_desc")}
        .defaultKey=${this.defaultKeybinds.gameSpeedUp}
        .value=${this.getKeyValue(KeybindAction.gameSpeedUp)}
        .display=${this.getKeyChar(KeybindAction.gameSpeedUp)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.gameSpeedDown}
        label=${translateText("user_setting.game_speed_down")}
        description=${translateText("user_setting.game_speed_down_desc")}
        .defaultKey=${this.defaultKeybinds.gameSpeedDown}
        .value=${this.getKeyValue(KeybindAction.gameSpeedDown)}
        .display=${this.getKeyChar(KeybindAction.gameSpeedDown)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.attack_ratio_controls")}
      </h2>

      <setting-keybind
        action=${KeybindAction.attackRatioDown}
        label=${translateText("user_setting.attack_ratio_down")}
        description=${translateText("user_setting.attack_ratio_down_desc", {
          amount: this.userSettings.attackRatioIncrement(),
        })}
        .defaultKey=${this.defaultKeybinds.attackRatioDown}
        .value=${this.getKeyValue(KeybindAction.attackRatioDown)}
        .display=${this.getKeyChar(KeybindAction.attackRatioDown)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.attackRatioUp}
        label=${translateText("user_setting.attack_ratio_up")}
        description=${translateText("user_setting.attack_ratio_up_desc", {
          amount: this.userSettings.attackRatioIncrement(),
        })}
        .defaultKey=${this.defaultKeybinds.attackRatioUp}
        .value=${this.getKeyValue(KeybindAction.attackRatioUp)}
        .display=${formatKeyForDisplay(
          this.getKeyValue(KeybindAction.attackRatioUp as KeybindAction) || "",
        )}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.attack_keybinds")}
      </h2>

      <setting-keybind
        action=${KeybindAction.boatAttack}
        label=${translateText("user_setting.boat_attack")}
        description=${translateText("user_setting.boat_attack_desc")}
        .defaultKey=${this.defaultKeybinds.boatAttack}
        .value=${this.getKeyValue(KeybindAction.boatAttack)}
        .display=${this.getKeyChar(KeybindAction.boatAttack)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.groundAttack}
        label=${translateText("user_setting.ground_attack")}
        description=${translateText("user_setting.ground_attack_desc")}
        .defaultKey=${this.defaultKeybinds.groundAttack}
        .value=${this.getKeyValue(KeybindAction.groundAttack)}
        .display=${this.getKeyChar(KeybindAction.groundAttack)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.swapDirection}
        label=${translateText("user_setting.swap_direction")}
        description=${translateText("user_setting.swap_direction_desc")}
        .defaultKey=${this.defaultKeybinds.swapDirection}
        .value=${this.getKeyValue(KeybindAction.swapDirection)}
        .display=${this.getKeyChar(KeybindAction.swapDirection)}
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
        action=${KeybindAction.zoomOut}
        label=${translateText("user_setting.zoom_out")}
        description=${translateText("user_setting.zoom_out_desc")}
        .defaultKey=${this.defaultKeybinds.zoomOut}
        .value=${this.getKeyValue(KeybindAction.zoomOut)}
        .display=${this.getKeyChar(KeybindAction.zoomOut)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.zoomIn}
        label=${translateText("user_setting.zoom_in")}
        description=${translateText("user_setting.zoom_in_desc")}
        .defaultKey=${this.defaultKeybinds.zoomIn}
        .value=${this.getKeyValue(KeybindAction.zoomIn)}
        .display=${this.getKeyChar(KeybindAction.zoomIn)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <h2
        class="text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2"
      >
        ${translateText("user_setting.camera_movement")}
      </h2>

      <setting-keybind
        action=${KeybindAction.centerCamera}
        label=${translateText("user_setting.center_camera")}
        description=${translateText("user_setting.center_camera_desc")}
        .defaultKey=${this.defaultKeybinds.centerCamera}
        .value=${this.getKeyValue(KeybindAction.centerCamera)}
        .display=${this.getKeyChar(KeybindAction.centerCamera)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.moveUp}
        label=${translateText("user_setting.move_up")}
        description=${translateText("user_setting.move_up_desc")}
        .defaultKey=${this.defaultKeybinds.moveUp}
        .value=${this.getKeyValue(KeybindAction.moveUp)}
        .display=${this.getKeyChar(KeybindAction.moveUp)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.moveLeft}
        label=${translateText("user_setting.move_left")}
        description=${translateText("user_setting.move_left_desc")}
        .defaultKey=${this.defaultKeybinds.moveLeft}
        .value=${this.getKeyValue(KeybindAction.moveLeft)}
        .display=${this.getKeyChar(KeybindAction.moveLeft)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.moveDown}
        label=${translateText("user_setting.move_down")}
        description=${translateText("user_setting.move_down_desc")}
        .defaultKey=${this.defaultKeybinds.moveDown}
        .value=${this.getKeyValue(KeybindAction.moveDown)}
        .display=${this.getKeyChar(KeybindAction.moveDown)}
        @change=${this.handleKeybindChange}
      ></setting-keybind>

      <setting-keybind
        action=${KeybindAction.moveRight}
        label=${translateText("user_setting.move_right")}
        description=${translateText("user_setting.move_right_desc")}
        .defaultKey=${this.defaultKeybinds.moveRight}
        .value=${this.getKeyValue(KeybindAction.moveRight)}
        .display=${this.getKeyChar(KeybindAction.moveRight)}
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
